#!/usr/bin/env python3
"""Poll a trusted Git branch and deploy an already provisioned Compose stack."""

import argparse
import fcntl
from http.client import HTTPException
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class DeploymentError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        # Never forward a publishing credential to a redirect destination.
        return None


class NtfyNotifier:
    def __init__(self, url, token, logger):
        self.url = url
        self.token = token
        self.logger = logger

    @classmethod
    def from_env(cls, logger, environment=None):
        environment = os.environ if environment is None else environment
        url = (
            environment.get("NTFY_URL") or environment.get("NTFY_TOPIC_URL") or ""
        ).strip()
        topic = environment.get("NTFY_TOPIC", "").strip()
        if not url and topic:
            server = (
                environment.get("NTFY_SERVER")
                or environment.get("NTFY_BASE_URL")
                or "https://ntfy.sh"
            ).strip()
            url = (
                topic if topic.startswith(("https://", "http://"))
                else f"{server.rstrip('/')}/{topic}"
            )
        if not url:
            return None
        token = environment.get("NTFY_TOKEN", "").strip()
        try:
            parsed = urlsplit(url)
            if (
                parsed.scheme not in ("https", "http")
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.query
                or parsed.fragment
                or not re.fullmatch(
                    r"[-_A-Za-z0-9]{1,64}", parsed.path.rstrip("/").rsplit("/", 1)[-1]
                )
                or any(ord(char) < 32 for char in url + token)
            ):
                raise ValueError("Invalid ntfy configuration")
            # Validate a malformed port here, not after a deployment has finished.
            parsed.port
        except ValueError:
            logger.warning(
                "Invalid ntfy configuration; notifications disabled. "
                "Check NTFY_URL/NTFY_TOPIC and NTFY_TOKEN."
            )
            return None
        return cls(url.rstrip("/"), token, logger)

    def send(self, notification):
        components = notification["components"]
        labels = {"web": "Frontend", "api": "Backend"}
        names = [
            label.lower() for service, label in labels.items() if service in components
        ]
        lines = [f"Sobi deployment {notification['commit'][:12]} is healthy."]
        for service, label in labels.items():
            if service in components:
                version = components[service].removeprefix("sha256:")[:12]
                lines.append(f"{label}: {version}")
        headers = {
            "Content-Type": "text/plain; charset=utf-8",
            "Title": f"Sobi updated: {' and '.join(names)}",
            "Tags": "sobi,deploy",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = Request(
            self.url, data="\n".join(lines).encode("utf-8"),
            headers=headers, method="POST",
        )
        try:
            with build_opener(NoRedirect()).open(request, timeout=5) as response:
                if not 200 <= response.status < 300:
                    raise OSError("ntfy did not accept the notification")
        except (OSError, ValueError, HTTPException) as error:
            if isinstance(error, HTTPError):
                error.close()
            # URLs, tokens, and response bodies can contain secrets.
            self.logger.warning(
                "ntfy delivery failed (%s); will retry on the next poll.",
                type(error).__name__,
            )
            return False
        self.logger.info("ntfy deployment notification delivered")
        return True


class Deployer:
    def __init__(self, args, logger):
        self.repo = args.repo.resolve()
        self.state = args.state_dir.resolve()
        self.backups = (args.backup_dir or self.state / "backups").resolve()
        if self.state.is_relative_to(self.repo) or self.backups.is_relative_to(self.repo):
            raise DeploymentError("State and backup directories must be outside the checkout.")
        self.branch = args.branch
        self.health_timeout = args.health_timeout
        self.build_timeout = args.build_timeout
        self.logger = logger
        self.notifier = NtfyNotifier.from_env(logger)
        self.compose = ["docker", "compose", "--project-directory", str(self.repo)]
        for file in args.compose_file or ["docker-compose.prod.yml"]:
            self.compose.extend(["-f", str(self.repo / file)])
        self.compose.extend(["--env-file", str(self.repo / args.env_file)])

    def run(self, command, *, capture=False, stdout=None, stdin=None, timeout=None):
        env = os.environ.copy()
        env["GIT_TERMINAL_PROMPT"] = "0"
        env.setdefault("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=15")
        options = dict(
            cwd=self.repo,
            env=env,
            stdin=stdin,
            stdout=stdout if stdout is not None else subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        timed_out = False
        if timeout is None:
            result = subprocess.run(command, **options)
        else:
            # Compose can spawn buildx and credential helpers. Isolate the build
            # so a timeout kills those children too, not just the Compose CLI.
            process = subprocess.Popen(command, start_new_session=True, **options)
            try:
                output, errors = process.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                output, errors = process.communicate()
            result = subprocess.CompletedProcess(
                command, process.returncode, output, errors
            )
        output = (result.stdout or b"").decode("utf-8", errors="replace")
        errors = result.stderr.decode("utf-8", errors="replace")
        if not capture or result.returncode or timed_out:
            for line in (output + errors).splitlines():
                self.logger.info("%s", line)
        if timed_out:
            raise DeploymentError(
                f"{command[0]} {command[1]} timed out after {timeout} seconds; "
                "build process group killed"
            )
        if result.returncode:
            raise DeploymentError(
                f"{command[0]} {command[1]} failed (exit {result.returncode})"
            )
        return output.strip()

    def git(self, *args):
        return self.run(["git", *args], capture=True)

    def require_clean_checkout(self):
        if self.git("status", "--porcelain", "--untracked-files=all"):
            raise DeploymentError(
                "Checkout has local changes or untracked files; refusing to deploy."
            )
        if self.git("symbolic-ref", "--short", "HEAD") != self.branch:
            raise DeploymentError(f"Checkout must be on branch {self.branch}.")

    def backup(self, target):
        self.backups.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.backups.chmod(0o700)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        fd, temporary = tempfile.mkstemp(
            prefix=f"{timestamp}-{target[:12]}-", suffix=".partial", dir=self.backups
        )
        temporary = Path(temporary)
        try:
            self.logger.info("Backing up Postgres before restarting the API")
            with os.fdopen(fd, "wb") as dump:
                self.run(
                    self.compose
                    + ["exec", "-T", "db", "pg_dump", "-U", "sobi", "-Fc", "sobi"],
                    stdout=dump,
                )
                dump.flush()
                os.fsync(dump.fileno())
            if temporary.stat().st_size == 0:
                raise DeploymentError("Database backup is empty.")
            with temporary.open("rb") as dump:
                self.run(
                    self.compose + ["exec", "-T", "db", "pg_restore", "--list"],
                    stdin=dump,
                    capture=True,
                )
            destination = temporary.with_suffix(".dump")
            os.replace(temporary, destination)
            self.logger.info("Database backup verified: %s", destination)
        finally:
            temporary.unlink(missing_ok=True)

    def record_success(self, target):
        fd, temporary = tempfile.mkstemp(prefix="deployed-", dir=self.state)
        try:
            with os.fdopen(fd, "w") as marker:
                marker.write(target + "\n")
                marker.flush()
                os.fsync(marker.fileno())
            os.replace(temporary, self.state / "deployed-commit")
        finally:
            Path(temporary).unlink(missing_ok=True)

    def write_json(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, temporary = tempfile.mkstemp(prefix=path.name + "-", dir=path.parent)
        try:
            with os.fdopen(fd, "w") as output:
                json.dump(value, output)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            Path(temporary).unlink(missing_ok=True)

    def image_versions(self):
        versions = {}
        for service in ("api", "web"):
            container = self.run(
                self.compose + ["ps", "--all", "--quiet", service], capture=True
            )
            if not container or len(container.splitlines()) != 1:
                raise DeploymentError(f"Expected exactly one {service} container.")
            image = self.run(
                ["docker", "inspect", "--format", "{{.Image}}", container], capture=True
            )
            if not re.fullmatch(r"sha256:[0-9a-f]{64}", image):
                raise DeploymentError(f"Could not determine {service} image version.")
            versions[service] = image
        return versions

    def notification_baseline(self):
        if not self.notifier:
            return None
        path = self.state / "deployed-images.json"
        try:
            if path.exists():
                versions = json.loads(path.read_text())
                if not isinstance(versions, dict) or any(
                    not isinstance(versions.get(service), str)
                    or not re.fullmatch(r"sha256:[0-9a-f]{64}", versions[service])
                    for service in ("api", "web")
                ):
                    raise ValueError("Invalid image version state")
                return versions
            versions = self.image_versions()
            # Keep the last good baseline even if an attempted deployment partially restarts.
            self.write_json(path, versions)
            return versions
        except (DeploymentError, OSError, ValueError):
            self.logger.warning(
                "Could not establish ntfy image-version baseline; deployment will continue."
            )
            return None

    def flush_notifications(self):
        if not self.notifier:
            return
        for path in sorted((self.state / "notifications").glob("*.json")):
            try:
                notification = json.loads(path.read_text())
                components = notification.get("components")
                if (
                    not isinstance(notification.get("commit"), str)
                    or not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", notification["commit"])
                    or not isinstance(components, dict)
                    or not components
                    or any(
                        service not in ("api", "web")
                        or not isinstance(version, str)
                        or not re.fullmatch(r"sha256:[0-9a-f]{64}", version)
                        for service, version in components.items()
                    )
                ):
                    raise ValueError("Invalid pending notification")
                if not self.notifier.send(notification):
                    break
                path.unlink()
            except (OSError, ValueError, AttributeError):
                self.logger.warning(
                    "Could not process an ntfy queue entry; deployment will continue."
                )

    def notify_deployment(self, target, previous):
        if not self.notifier or previous is None:
            return
        try:
            current = self.image_versions()
            changed = {
                service: version for service, version in current.items()
                if previous.get(service) != version
            }
            if changed:
                self.write_json(
                    self.state / "notifications" / f"{target}.json",
                    {"commit": target, "components": changed},
                )
            self.write_json(self.state / "deployed-images.json", current)
            self.flush_notifications()
        except (DeploymentError, OSError, ValueError):
            self.logger.warning(
                "Could not queue ntfy deployment notification; "
                "successful deployment is unchanged."
            )

    def deploy(self):
        # State must not accidentally suppress deployments for another checkout.
        binding = self.state / "checkout"
        if binding.exists() and binding.read_text().strip() != str(self.repo):
            raise DeploymentError("State directory belongs to another checkout.")
        binding.write_text(str(self.repo) + "\n")
        self.require_clean_checkout()
        self.logger.info("Fetching origin/%s", self.branch)
        self.git("check-ref-format", f"refs/heads/{self.branch}")
        self.git("fetch", "--no-tags", "origin", f"refs/heads/{self.branch}")
        target = self.git("rev-parse", "--verify", "FETCH_HEAD^{commit}")
        # Do this even if the marker matches: never accept local-only commits.
        try:
            self.git("merge-base", "--is-ancestor", "HEAD", target)
        except DeploymentError as error:
            raise DeploymentError(
                f"Checkout cannot fast-forward to origin/{self.branch}; refusing local-only history."
            ) from error
        marker = self.state / "deployed-commit"
        self.flush_notifications()
        if marker.exists() and marker.read_text().strip() == target:
            self.logger.info("Already deployed %s; nothing to do", target)
            return
        previous_images = self.notification_baseline()
        # Check again after the fetch, before touching the working tree.
        self.require_clean_checkout()
        self.logger.info("Fast-forwarding checkout to %s", target)
        self.git("merge", "--ff-only", target)
        self.logger.info("Building API and web images (running containers stay up)")
        self.run(self.compose + ["build", "api", "web"], timeout=self.build_timeout)
        self.require_clean_checkout()
        if self.git("rev-parse", "HEAD") != target:
            raise DeploymentError("Checkout HEAD changed during the build; refusing to deploy.")
        self.backup(target)
        self.logger.info("Deploying API and web; waiting for health checks")
        self.run(
            self.compose
            + [
                "up", "-d", "--no-deps", "--no-build", "--wait",
                "--wait-timeout", str(self.health_timeout), "api", "web",
            ]
        )
        # --wait accepts 'running' for services without a healthcheck. Require
        # explicit healthy status for both services before advancing the marker.
        for service in ("api", "web"):
            container = self.run(
                self.compose + ["ps", "--all", "--quiet", service], capture=True
            )
            if not container or len(container.splitlines()) != 1:
                raise DeploymentError(f"Expected exactly one {service} container.")
            health = self.run(
                ["docker", "inspect", "--format", "{{.State.Health.Status}}", container],
                capture=True,
            )
            if health != "healthy":
                raise DeploymentError(f"{service} did not report healthy.")
        self.record_success(target)
        self.logger.info("Successfully deployed %s", target)
        self.notify_deployment(target, previous_images)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--backup-dir", type=Path)
    parser.add_argument("--branch", default="master")
    parser.add_argument("--compose-file", action="append")
    parser.add_argument("--env-file", default=".env.production")
    parser.add_argument("--health-timeout", type=int, default=180)
    parser.add_argument("--build-timeout", type=int, default=900)
    args = parser.parse_args(argv)
    if args.health_timeout <= 0:
        parser.error("--health-timeout must be positive")
    if args.build_timeout <= 0:
        parser.error("--build-timeout must be positive")
    return args


def main(argv=None):
    args = parse_args(argv)
    # Keep the process umask: Git and Docker builds inherit it, and an owner-only umask
    # makes checked-out files unreadable to nginx inside the web image.
    state = args.state_dir.resolve()
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    state.chmod(0o700)
    # flock is available on macOS/Linux through Python even without a flock CLI.
    # The OS releases the lock on exit/crash; never unlink the shared lock file.
    with (state / "deploy.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Another deployment is running; skipping this poll.", file=sys.stderr)
            return 0
        logger = logging.getLogger("sobi.deploy")
        logger.setLevel(logging.INFO)
        formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
        log_file = state / "deploy.log"
        handlers = [
            RotatingFileHandler(log_file, maxBytes=5_000_000, backupCount=3),
            logging.StreamHandler(),
        ]
        log_file.chmod(0o600)
        for handler in handlers:
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        try:
            Deployer(args, logger).deploy()
            return 0
        except (DeploymentError, OSError, subprocess.SubprocessError) as error:
            logger.error("Deployment failed: %s. Successful-commit marker unchanged.", error)
            return 1
        finally:
            for handler in handlers:
                logger.removeHandler(handler)
                handler.close()


if __name__ == "__main__":
    sys.exit(main())
