# Sobi

Sobi turns workouts into drinks. Log gym sessions to earn **standard drinks** (US definition,
14 g of pure alcohol) and log what you drink to spend them. The dashboard shows your balance,
which can go negative (debt, shown in red), plus history and weekly stats.

One Expo web/PWA app backed by a Fastify + Drizzle + Postgres API. Google sign-in only; every
user sees only their own data.

| Path           | What it is                                               |
| -------------- | -------------------------------------------------------- |
| `apps/backend` | Fastify 5 API, Drizzle ORM, Postgres 17, Vitest          |
| `apps/mobile`  | Expo Router app (web/PWA), React Query, react-native-svg |
| `docker/`      | Web image (nginx), API entrypoint (migrations), test DB  |
| `scripts/`     | `deploy.py` host-side polling deployer and its tests     |

## How the math works

- A drink: `alcohol_g = volume_ml × abv / 100 × 0.789` and `std_drinks = alcohol_g / 14`.
- An exercise earns `earn_drinks` per `earn_per` units (reps, seconds or meters). A set of
  `amount` units earns `amount / earn_per × earn_drinks`.
- Both values are computed by the server and stored on the set or drink when it is logged, so
  changing a rate later never rewrites history.

## Local development

Requires Node 24+ and Docker.

```sh
npm install
cp .env.example .env                 # fill in the three secrets
cp apps/mobile/.env.example apps/mobile/.env
docker compose up -d                 # Postgres on :5434, API on :3100 (migrates on boot)
npm run web -w apps/mobile           # Expo web on http://localhost:8083
```

Set `EXPO_PUBLIC_DEV_AUTH` in `apps/mobile/.env` to the `DEV_AUTH_SECRET` from `.env` to get a
dev sign-in box on the login screen. It signs in (and creates) a user by email through
`POST /auth/dev-token`, which does not exist in production.

API docs are served at http://localhost:3100/docs.

## Checks

```sh
npm run typecheck
npm run lint
npm test                             # backend tests need `docker compose up -d db`
npm run test:scripts                 # deploy script tests
```

## Database migrations

The schema lives in `apps/backend/src/db/schema.ts`. After changing it:

```sh
DATABASE_URL=postgres://sobi:sobi@localhost:5434/sobi_dev npm run db:generate -w apps/backend
```

## Production

See [SELF-HOSTING.md](SELF-HOSTING.md). In short: `npm run prod -- up -d --build`.
