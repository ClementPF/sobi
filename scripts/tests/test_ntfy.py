from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import logging
from pathlib import Path
import threading
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError


spec = importlib.util.spec_from_file_location(
    "deploy_ntfy", Path(__file__).resolve().parents[1] / "deploy.py"
)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

URL = "https://ntfy.example.com/private-topic"
TOKEN = "test-publishing-token"
NOTIFICATION = {
    "commit": "a" * 40,
    "components": {"web": "sha256:" + "1" * 64, "api": "sha256:" + "2" * 64},
}


class NtfyTests(unittest.TestCase):
    def setUp(self):
        self.logger = Mock(spec=logging.Logger)

    def configured(self, environment=None):
        return deploy.NtfyNotifier.from_env(
            self.logger, environment or {"NTFY_URL": URL, "NTFY_TOKEN": TOKEN}
        )

    def test_accepts_existing_host_environment_variable_forms(self):
        for environment, expected in (
            ({"NTFY_URL": URL}, URL),
            ({"NTFY_TOPIC_URL": URL}, URL),
            ({"NTFY_TOPIC": "private-topic"}, "https://ntfy.sh/private-topic"),
            ({"NTFY_SERVER": "https://ntfy.example.com/", "NTFY_TOPIC": "private-topic"}, URL),
            ({"NTFY_BASE_URL": "https://ntfy.example.com/", "NTFY_TOPIC": "private-topic"}, URL),
            ({"NTFY_TOPIC": URL}, URL),
            ({"NTFY_URL": URL + "/"}, URL),
        ):
            with self.subTest(environment=environment):
                self.assertEqual(self.configured(environment).url, expected)

    def test_host_environment_is_used_by_default(self):
        with patch.dict(deploy.os.environ, {"NTFY_URL": URL, "NTFY_TOKEN": TOKEN}):
            notifier = deploy.NtfyNotifier.from_env(self.logger)
        self.assertEqual(notifier.url, URL)
        self.assertEqual(notifier.token, TOKEN)

    def test_no_topic_means_no_notifications(self):
        for environment in ({}, {"NTFY_TOKEN": TOKEN}, {"NTFY_SERVER": "https://ntfy.example.com"}):
            with self.subTest(environment=environment):
                self.assertIsNone(deploy.NtfyNotifier.from_env(self.logger, environment))

    def test_invalid_configuration_is_disabled_without_logging_secrets(self):
        for url in (
            "file:///private-topic",
            "https://user:secret@ntfy.example.com/private-topic",
            URL + "?token=secret",
            URL + "#secret",
            "https://ntfy.example.com/",
            "https://ntfy.example.com:invalid/private-topic",
            "https://ntfy.example.com/private\ntopic",
        ):
            with self.subTest(url=url):
                self.assertIsNone(self.configured({"NTFY_URL": url, "NTFY_TOKEN": TOKEN}))
        self.assertIsNone(self.configured({"NTFY_URL": URL, "NTFY_TOKEN": "secret\ninjected"}))
        logs = str(self.logger.warning.call_args_list)
        for secret in ("secret", TOKEN, "private-topic"):
            self.assertNotIn(secret, logs)

    def test_sends_component_versions_with_optional_bearer_auth_and_a_timeout(self):
        for token in ("", TOKEN):
            with self.subTest(authenticated=bool(token)):
                notifier = self.configured({"NTFY_URL": URL, "NTFY_TOKEN": token})
                with patch.object(deploy, "build_opener") as build:
                    opener = build.return_value
                    opener.open.return_value.__enter__.return_value.status = 201
                    self.assertTrue(notifier.send(NOTIFICATION))
                request = opener.open.call_args.args[0]
                self.assertEqual(request.full_url, URL)
                self.assertEqual(request.get_method(), "POST")
                self.assertEqual(request.get_header("Title"), "Sobi updated: frontend and backend")
                body = request.data.decode("utf-8")
                self.assertIn("deployment aaaaaaaaaaaa is healthy", body)
                self.assertIn("Frontend: 111111111111", body)
                self.assertIn("Backend: 222222222222", body)
                self.assertEqual(request.get_header("Authorization"), f"Bearer {token}" if token else None)
                self.assertEqual(opener.open.call_args.kwargs["timeout"], 5)
                self.assertIsInstance(build.call_args.args[0], deploy.NoRedirect)

    def test_single_component_notifications_do_not_claim_both_were_updated(self):
        with patch.object(deploy, "build_opener") as build:
            build.return_value.open.return_value.__enter__.return_value.status = 201
            self.assertTrue(self.configured().send({
                "commit": "a" * 40, "components": {"web": "sha256:" + "1" * 64},
            }))
        request = build.return_value.open.call_args.args[0]
        self.assertEqual(request.get_header("Title"), "Sobi updated: frontend")
        self.assertNotIn("Backend", request.data.decode())

    def test_network_and_http_failures_are_retryable_without_leaking_secrets(self):
        for error in (
            URLError(URL + TOKEN),
            HTTPError(URL, 401, TOKEN, {}, None),
            TimeoutError(TOKEN),
            deploy.HTTPException(TOKEN),
        ):
            with self.subTest(error=type(error).__name__):
                with patch.object(deploy, "build_opener") as build:
                    build.return_value.open.side_effect = error
                    self.assertFalse(self.configured().send(NOTIFICATION))
        logs = str(self.logger.warning.call_args_list)
        self.assertNotIn(URL, logs)
        self.assertNotIn(TOKEN, logs)

    def test_non_success_responses_are_not_acknowledged(self):
        with patch.object(deploy, "build_opener") as build:
            build.return_value.open.return_value.__enter__.return_value.status = 500
            self.assertFalse(self.configured().send(NOTIFICATION))

    def test_real_http_publishing_and_redirect_rejection(self):
        # A local fake ntfy server exercises urllib itself; no real topic receives a message.
        for status in (201, 302):
            received = []

            class Handler(BaseHTTPRequestHandler):
                def do_POST(self):
                    body = self.rfile.read(int(self.headers["Content-Length"]))
                    received.append((self.path, self.headers.get("Authorization"), body))
                    self.send_response(status)
                    if status == 302:
                        self.send_header("Location", "/unexpected")
                    self.end_headers()

                def do_GET(self):
                    received.append((self.path, None, b""))
                    self.send_response(200)
                    self.end_headers()

                def log_message(self, *args):
                    pass

            with self.subTest(status=status), ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
                thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
                thread.start()
                try:
                    url = f"http://127.0.0.1:{server.server_port}/updates"
                    notifier = self.configured({"NTFY_URL": url, "NTFY_TOKEN": TOKEN})
                    self.assertEqual(notifier.send(NOTIFICATION), status == 201)
                    self.assertEqual(len(received), 1)
                    self.assertEqual(received[0][0], "/updates")
                    self.assertEqual(received[0][1], f"Bearer {TOKEN}")
                    self.assertIn(b"Frontend: 111111111111", received[0][2])
                finally:
                    server.shutdown()
                    thread.join(timeout=2)
                self.assertFalse(thread.is_alive())


if __name__ == "__main__":
    unittest.main()
