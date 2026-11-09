# Self-hosting

Runs the production stack on one always-on machine (for example an old MacBook) and publishes it
through a Cloudflare Tunnel. `docker-compose.prod.yml` starts four containers:

| Service       | What it runs                                            | Reached at               |
| ------------- | ------------------------------------------------------- | ------------------------ |
| `db`          | Postgres 17, data in the `sobi_prod_pgdata` volume      | compose network only     |
| `api`         | `Dockerfile` `prod` target, `APP_ENV=production`        | `https://<API_HOSTNAME>` |
| `web`         | Static Expo web export served by nginx (`docker/web/`)  | `https://<APP_HOSTNAME>` |
| `cloudflared` | Optional Cloudflare Tunnel connector (`tunnel` profile) | outbound connection only |

With the bundled tunnel no port is published on the host: Cloudflare forwards traffic to `api`
and `web` over the compose network. If a reverse proxy and tunnel already run on another
machine, publish `api` and `web` on the local network instead (option B below). The api applies database migrations on boot, and
`/auth/dev-token` does not exist in production, so users sign in with Google.

The hosted instance uses `APP_HOSTNAME=sobi.wtchthfck.com` and `API_HOSTNAME=sobi-api.wtchthfck.com`
(both one level below `wtchthfck.com`, so Cloudflare's free certificate covers them).

## 1. Cloudflare Tunnel

Pick the option that matches your network.

### Option A: tunnel in this stack (one machine)

1. In the Cloudflare dashboard, open **Zero Trust → Networks → Tunnels** and create a tunnel of
   type **Cloudflared** (for example `sobi`). Use a dedicated tunnel: your other tunnels'
   connectors cannot resolve the `api` and `web` container names.
2. On the connector install step, copy the token (the long value after `--token`). It goes into
   `CLOUDFLARE_TUNNEL_TOKEN`; there is nothing to install on the host.
3. Add two public hostnames to the tunnel:

   | Public hostname     | Service type | URL        |
   | ------------------- | ------------ | ---------- |
   | `app.<your-domain>` | HTTP         | `web:80`   |
   | `api.<your-domain>` | HTTP         | `api:3100` |

### Option B: existing tunnel and reverse proxy on another machine

`docker-compose.lan.yml` publishes the api on port `3100` and the web app on port `8080` of the
server, and the `cloudflared` service stays off. Leave `CLOUDFLARE_TUNNEL_TOKEN` empty. If either
port is taken, set `API_PORT` / `WEB_PORT` in `.env.production` and use those in the proxy.

1. On the proxy machine, route both hostnames to the server (`<server-ip>` below). With nginx:

   ```nginx
   server {
     listen 80;
     server_name app.<your-domain>;
     location / {
       proxy_pass http://<server-ip>:8080;
       proxy_set_header Host $host;
     }
   }
   server {
     listen 80;
     server_name api.<your-domain>;
     location / {
       proxy_pass http://<server-ip>:3100;
       proxy_set_header Host $host;
     }
   }
   ```

2. In your existing tunnel, add `app.<your-domain>` and `api.<your-domain>` as public hostnames
   pointing at the proxy (the same service URL your other hostnames use, for example
   `http://localhost:80`).
3. Reserve both machines' IP addresses in your router so the proxy keeps reaching the server.

Ports 3100 and 8080 are open to the whole local network; restrict them to the proxy's address in
the server's firewall if that matters.

Either way, Cloudflare terminates HTTPS, so both hostnames are served over `https://`. Cloudflare's
free certificate only covers one subdomain level (`*.<your-domain>`): use names like
`app.<your-domain>`, not `app.sub.<your-domain>`, which fail the TLS handshake.

## 2. Google OAuth client

In Google Cloud Console (**APIs & Services → Credentials**), open the Web-application client
whose ID is `GOOGLE_CLIENT_ID` and add `https://app.<your-domain>` to both **Authorized
JavaScript origins** and **Authorized redirect URIs**. Keep `http://localhost:8083` for local
development. Copy the client secret for the next step (create a new one with **Add secret** if
the existing one is no longer shown).

## 3. Configure

From the repo root on the server:

```sh
cp .env.production.example .env.production
for k in POSTGRES_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET DEV_AUTH_SECRET; do sed -i '' "s|^$k=.*|$k=$(openssl rand -hex 32)|" .env.production; done
```

Then edit `.env.production` and set `APP_HOSTNAME`, `API_HOSTNAME`, `GOOGLE_CLIENT_SECRET` and,
for option A, `CLOUDFLARE_TUNNEL_TOKEN`. The file is gitignored; never commit it. Use the production secrets only
here, not the ones from your development `.env`.

The compose file derives the rest from these values: the api allows CORS and Google redirects
from `https://<APP_HOSTNAME>` only. The web app is built against `https://<API_HOSTNAME>` with
`EXPO_PUBLIC_WEB_URL=https://<APP_HOSTNAME>` and dev sign-in removed.

## 4. Start

Option A (tunnel in this stack):

```sh
npm run prod -- --profile tunnel up -d --build
```

Option B (reverse proxy on another machine):

```sh
npm run prod:lan -- up -d --build
curl http://localhost:3100/health   # also from the proxy machine: http://<server-ip>:3100/health
```

Then check:

```sh
npm run prod -- ps          # api, db and web should become healthy
curl https://api.<your-domain>/health
```

`npm run prod --` wraps `docker compose -f docker-compose.prod.yml --env-file .env.production`
(`prod:lan` adds `-f docker-compose.lan.yml`), so any compose command works:
`npm run prod -- logs -f api`, `npm run prod -- down`.
Open `https://app.<your-domain>` and sign in with Google. On a phone, open the same URL in
Safari and use **Share → Add to Home Screen**. Expo Go cannot sign in against this server:
Google rejects its `exp://` redirect and dev sign-in is disabled in production.

## Updating

```sh
git pull
npm run prod -- --profile tunnel up -d --build   # option B: npm run prod:lan -- up -d --build
```

The web image inlines `APP_HOSTNAME`/`API_HOSTNAME`/`GOOGLE_CLIENT_ID` at build time, so rebuild
(`--build`) after changing them.

The api applies pending migrations on boot. Back up the database first (see [Backups](#backups)).

## Automatic updates with host-side polling

`scripts/deploy.py` polls `origin/master` and deploys new commits with Docker Compose. It needs
Python 3.9+, Git, Docker Compose v2 with `up --wait`, and an **already running production stack**,
including Postgres. It does not provision the initial stack. No Node installation, inbound
webhook, GitHub runner, or third-party Python packages are required on the host.

Use a dedicated production clone checked out on `master`. Give its user read access to the Git
remote (for a private repo, prefer a read-only deploy key), access to Docker, and ownership of
the state/backup directories. Confirm Git authentication works without a password prompt.
Only trusted code should merge to the deployment branch: it executes on the production host.

### First run

After this script is merged, update the production checkout manually once. From the host,
replace the paths below with absolute paths for that machine:

```sh
python3 /path/to/sobi/scripts/deploy.py \
  --repo /path/to/sobi \
  --state-dir /path/to/sobi-deploy-state
```

Keep the state and backup directories **outside the checkout**. By default, backups go into
`<state-dir>/backups`; use `--backup-dir /path/on/another/disk` to store them elsewhere.
Keep `.env.production` in the production checkout; it remains gitignored.

If using the separate-machine reverse-proxy setup, pass both Compose files on every run
(after the LAN configuration has also been merged):

```sh
python3 /path/to/sobi/scripts/deploy.py \
  --repo /path/to/sobi \
  --state-dir /path/to/sobi-deploy-state \
  --compose-file docker-compose.prod.yml \
  --compose-file docker-compose.lan.yml
```

The script:

1. Takes an exclusive OS-managed lock. Overlapping polls skip; exiting or crashing releases
   the lock automatically. Always use the same state directory for a given production stack.
2. Refuses tracked changes, staged changes, untracked files, a different checked-out branch,
   or history that cannot fast-forward to the remote. It never resets, stashes, or cleans.
   Gitignored files such as `.env.production` are allowed.
3. Fetches the remote and compares its commit to `deployed-commit` in the state directory,
   **not** to checkout HEAD. A failed deployment still retries even if Git already advanced.
4. Fast-forwards to the fetched commit and builds both images while existing containers run.
5. Creates a private, timestamped Postgres custom-format backup and checks that it is nonempty
   and readable by `pg_restore --list`. A failed backup stops deployment before any restart.
   Every deployment gets a backup, including retries; existing backups are never overwritten.
6. Runs `up -d --no-deps --no-build --wait` for **only `api` and `web`**. Postgres and the tunnel
   are not restarted. Both containers must explicitly report `healthy`.
7. Atomically records the commit only after both health checks pass. Failures exit nonzero,
   leave the successful-commit marker unchanged, and retry on the next scheduled poll.

The first run has no marker, so it also backs up and redeploys the current commit. The default
build timeout is 900 seconds; adjust it with `--build-timeout 1200`. A timed-out build kills
the local build process group, including Compose, buildx, and credential helpers. It leaves
running containers and the successful-commit marker unchanged, so the next poll retries.
The health timeout is 180 seconds; adjust it with `--health-timeout 300`. Use `--branch main`
only if the repository's deployment branch is actually renamed to `main`.

Build output, deployment stages, and failures are recorded in `<state-dir>/deploy.log` and
stderr. The log rotates at approximately 5 MB, keeping three older files. State, logs, and
backups are created with private permissions. Backups contain production data: restrict access,
keep an off-host copy, monitor disk space, and set your own retention policy. No backups are
automatically deleted. Archive-list validation is not a substitute for periodic test restores.

Do not edit the production clone or run manual deployments while polling is active. This is
not zero-downtime deployment or automatic rollback: failed migrations/health checks can leave
the app unavailable. Fix forward or perform a deliberate database restore using the preserved
pre-deployment backup. A Git rollback alone cannot undo a database migration. The marker only
tracks code commits, so environment-only changes still require a manual rebuild/redeploy.

### macOS: run every minute with launchd

Run as the same logged-in user that runs Docker Desktop. Docker Desktop's default
`credsStore: desktop` uses a Keychain credential helper that can hang under launchd, even
when pulling public images. Use a separate Docker CLI configuration for this job without
`credsStore` or `credHelpers`. This stack uses public images; private registries would need
a separate noninteractive authentication setup. Leave your normal `~/.docker/config.json`
unchanged.

Create `~/.config/sobi-deploy-docker/config.json` (replace `YOU` with your username):

```sh
mkdir -p ~/.config/sobi-deploy-docker
chmod 700 ~/.config/sobi-deploy-docker
```

```json
{
  "cliPluginsExtraDirs": ["/Users/YOU/.docker/cli-plugins"]
}
```

The plugin path keeps Compose and buildx available. The plist below sets `DOCKER_CONFIG`
to that directory and `DOCKER_HOST` to Docker Desktop's per-user socket, since the separate
configuration does not inherit your normal Docker context.

Create
`~/Library/LaunchAgents/com.sobi.deploy.plist` with the following content. Replace every
`/Users/YOU` and repository path; replace `/usr/bin/python3` with the output of `command -v python3`
if needed. Paths in a plist must be absolute: `~` and shell variables are not expanded.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.sobi.deploy</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/bin/python3</string>
      <string>/Users/YOU/sobi/scripts/deploy.py</string>
      <string>--repo</string>
      <string>/Users/YOU/sobi</string>
      <string>--state-dir</string>
      <string>/Users/YOU/.local/state/sobi-deploy</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/Applications/Docker.app/Contents/Resources/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
      <key>DOCKER_CONFIG</key>
      <string>/Users/YOU/.config/sobi-deploy-docker</string>
      <key>DOCKER_HOST</key>
      <string>unix:///Users/YOU/.docker/run/docker.sock</string>
    </dict>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>RunAtLoad</key>
    <true />
    <key>StandardOutPath</key>
    <string>/Users/YOU/Library/Logs/sobi-deploy-launchd.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOU/Library/Logs/sobi-deploy-launchd.log</string>
  </dict>
</plist>
```

Add the two `--compose-file` arguments and their values to `ProgramArguments` if using the LAN
override. Ensure `~/Library/LaunchAgents` and `~/Library/Logs` exist, then load the agent:

```sh
plutil -lint ~/Library/LaunchAgents/com.sobi.deploy.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.sobi.deploy.plist
```

The first poll runs immediately. If Docker Desktop is still starting, the failure is logged
and the next poll retries. Inspect the rotating `deploy.log` in the state directory for results.
The separate launchd log also captures interpreter/startup errors; manage its retention yourself.
Docker Desktop still requires a logged-in session, as described below.

### Linux: run every minute with cron

Create a state directory owned by the deployment user outside the checkout. Add this entry
to **that user's** crontab, adjusting paths (and adding Compose overrides if needed):

```cron
PATH=/usr/local/bin:/usr/bin:/bin
* * * * * /usr/bin/python3 /srv/sobi/scripts/deploy.py --repo /srv/sobi --state-dir /home/deploy/.local/state/sobi-deploy
```

The same lock prevents overlapping runs if a build takes longer than a minute. Logs go into
the state directory; cron can also send stderr through its configured local mail delivery.

### Test the deployment script

These tests mock deployment operations and use a temporary Git repository for checkout checks.
They do not touch the running production stack:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -v
```

## Keeping a MacBook server up

- Docker Desktop: **Settings → General → Start Docker Desktop when you sign in**. Docker Desktop
  only runs in a logged-in session, so enable automatic login for the server user
  (**System Settings → Users & Groups**). Every container uses `restart: unless-stopped`.
- Never sleep, also with the lid closed (keep it on power): `sudo pmset -a sleep 0 disablesleep 1`.
- Power back on after an outage: `sudo pmset -a autorestart 1`.

## Importing spreadsheet data

`scripts/import_csv.py` turns a workouts CSV and a drinks CSV into SQL for one user (match by
the Google account's email). The user must have signed in once. It needs only Python 3:

```sh
python3 scripts/import_csv.py --email you@example.com \
  --workouts Workout26.csv --drinks COOH26.csv --dry-run \
  | docker compose -f docker-compose.prod.yml -f docker-compose.lan.yml --env-file .env.production \
    exec -T db psql -U sobi -d sobi -v ON_ERROR_STOP=1
```

`--dry-run` reports what would be imported and rolls back; drop it to commit. Workouts are
imported into the workout named by `--workout-name` (default `Workout`), creating it and any
missing exercises at `--earn-drinks` per `--earn-per` reps (default 3.6 per 1000). Sessions
are placed at 12:00 and drinks from 20:00 in `--tz` (default `America/Los_Angeles`). Days that
were already imported are skipped, so re-running with a longer file only adds the new days.
Run `python3 scripts/import_csv.py --help` for the CSV formats.

## Backups

All data lives in the `sobi_prod_pgdata` volume on this one machine. Dump it daily to
another disk or a synced folder:

```sh
mkdir -p ~/sobi-backups
npm run prod -- exec -T db pg_dump -U sobi -Fc sobi > ~/sobi-backups/$(date +%F).dump
```

Restore into a running stack with:

```sh
npm run prod -- exec -T db pg_restore -U sobi -d sobi --clean --if-exists < ~/sobi-backups/<date>.dump
```

`npm run prod -- down -v` deletes the volume and every row in it; use plain `down` to stop.
