# Self-hosting

## What you need

Docker with Compose, and a reverse proxy in front. No Node, no Python, no whisper on the host — the
images carry all of it.

Sizing, from what has actually been observed:

| | CPU | Memory | Disk |
|---|---|---|---|
| API + web + Postgres | ~1 core | ~600 MiB | small, plus your media |
| CPU worker with `medium` | 3 cores | 5 GiB limit | ~3 GiB image, plus model weights |
| GPU worker | 2 cores | 3 GiB limit | same image, 4 GiB VRAM is enough for `small` |

Media files are kept indefinitely in the `media-store` volume: budget disk for what your users
upload, not for what they upload per month.

## First install

```bash
git clone https://github.com/Nathandelenclos/WisperPlatform.git
cd WisperPlatform
cp .env.example .env
```

Three secrets have no default and the API refuses to start without them:

```bash
for name in BETTER_AUTH_SECRET MEDIA_TOKEN_SECRET WORKER_SHARED_TOKEN; do
  printf '%s=%s\n' "$name" "$(openssl rand -hex 32)"
done
```

| Variable | What it protects |
|---|---|
| `BETTER_AUTH_SECRET` | Session cookies. Rotating it signs everyone out. |
| `MEDIA_TOKEN_SECRET` | The HMAC media passes handed to workers. Rotating it invalidates in-flight jobs. |
| `WORKER_SHARED_TOKEN` | The bearer token of the platform's own workers. Rotating it means restarting API **and** workers together. |

Then set `POSTGRES_PASSWORD`, `WEB_ORIGIN` (the browser origin, used for CORS and trusted origins)
and `PUBLIC_API_URL`. Every other variable has a documented default in `.env.example`.

```bash
docker compose up -d --build
```

The first build downloads torch and the two diarisation models: several minutes, ~3 GiB.

## Reverse proxy

The web container publishes `WEB_PORT` (8080 by default) and serves the SPA plus a proxy to the API
under `/api/`. Two things your proxy must not break:

- **Server-sent events.** `/api/transcriptions/:id/events` streams the live transcript. Disable
  buffering and give it a long read timeout; nginx needs `proxy_buffering off`.
- **Upload size.** `MEDIA_MAX_BYTES` defaults to 2 GiB. A proxy with a 1 MiB body limit turns every
  upload into a 413 — the platform's own nginx already sets its limit from that variable.

## Migrations

Schema changes are versioned files under `apps/api/drizzle/`, applied by a dedicated `migrate`
service that runs to completion **before** the API starts. Never at application startup: several
API instances migrating at boot is a race.

They are additive by policy — new nullable columns, new tables — so a rolling deployment where old
and new code run together is safe. A destructive change takes two deployments (expand, then
contract) and never happens in the same release that stops using a column.

To apply them by hand against a running stack:

```bash
docker compose run --rm migrate
```

## Language

The interface ships in English and French. It picks one from the browser on the first visit, and a
selector in the top bar — and on the sign-in card, for someone who cannot read the current one —
overrides it. The choice is remembered per browser; there is nothing to configure server-side.

Error messages that come from the API are English only for now: they are the same strings the
worker protocol and the logs use.

## Backups

Two volumes hold everything that matters:

- `postgres-data` — accounts, transcriptions, segments, speakers, machine keys.
- `media-store` — the uploaded media.

Neither is backed up for you. A Postgres dump plus a copy of the media store is the whole backup:

```bash
docker compose exec -T wisper-postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > wisper.sql.gz
docker run --rm -v wisper_media-store:/src:ro -v "$PWD":/out alpine \
  tar czf /out/media-store.tar.gz -C /src .
```

Restoring the database without the media store leaves transcriptions whose media cannot be played
or re-transcribed. Restore both or neither.

## Upgrading

```bash
git pull
docker compose up -d --build
```

The `migrate` service runs first and the API waits for it. Watch it: a failed migration stops the
deployment instead of starting an API against a schema it does not understand.

## What is exposed, and what is not

- Postgres is **not** published on the host. The API reaches it over the project network.
- Workers never mount the media store. They download each media file with a pass that expires.
- The API's port is published on the loopback only, for the Vite dev server; production traffic
  goes through the web container.
