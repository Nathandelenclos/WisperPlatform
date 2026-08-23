# WisperPlatform

Self-hosted transcription. Drop a media file, `whisper` transcribes it, the text arrives in the
browser as it is produced, you correct it, you export it as SRT, VTT or plain text. Diarisation
tells you who speaks when, and you name the speakers. Nothing leaves your server.

The project starts from one command:

```bash
whisper "meeting.mov" --model medium --language French
```

That is exactly what the worker runs. The platform adds accounts, a work queue, live output in the
browser, correction, exports — and the option to run the compute somewhere other than the server.

## What it does

- **Live transcription.** Segments appear while whisper works, not at the end.
- **Correction in the browser.** Click into a line, fix it, it is saved.
- **Who speaks when.** A diarisation pass assigns a speaker to each line; rename one and the name
  propagates through the whole transcription and its exports.
- **Exports** as SRT, VTT (with `<v Marc>` voice tags) and plain text.
- **User accounts**, password or Google when the operator configured it. Your transcriptions wait
  for you.
- **Remote workers.** A worker only ever receives a media file and a model name: not your
  identity, not your file name. Anyone can run one.
- **Your own machine, if you want it.** Declare your PC as a machine and choose, per media,
  whether the service's servers or your machine does the work.

## Run your own

Requirements: Docker with Compose. Nothing else — no Node, no Python, no whisper on the host.

```bash
git clone https://github.com/Nathandelenclos/WisperPlatform.git
cd WisperPlatform
cp .env.example .env
```

Generate the three secrets and put them in `.env`:

```bash
for name in BETTER_AUTH_SECRET MEDIA_TOKEN_SECRET WORKER_SHARED_TOKEN; do
  printf '%s=%s\n' "$name" "$(openssl rand -hex 32)"
done
```

Also set `POSTGRES_PASSWORD`, `WEB_ORIGIN` and `PUBLIC_API_URL` — the URL the browser will use to
reach the platform. Then:

```bash
docker compose up -d --build
```

The interface listens on `WEB_PORT` (8080 by default) and the compose file publishes it as-is:
put your reverse proxy in front of it, and bind it to the loopback if the host is exposed. Every
variable is documented in `.env.example`, including the CPU and memory bounds of the workers.

**The first job for a model downloads its weights** (28 s for `tiny`, several minutes for
`medium`). The `postgres-data` and `media-store` volumes hold your data: back them up.

### With an NVIDIA card

```bash
docker compose --profile gpu up -d --build
```

Measured on a GTX 1050 Ti: `small` goes from 5 min 35 s (three CPU threads) to 32 s. Watch the
card's memory — 4 GiB will not hold `medium`, which stays on the CPU worker. If your driver is
older than 580, keep `TORCH_VARIANT=cu124`: the default torch wheel is built for CUDA 13 and
silently ignores Pascal cards.

## Lend some compute

A worker needs an API URL and a token. It downloads each media file with a short-lived pass,
transcribes it, publishes the segments, and keeps nothing.

```bash
docker run --rm \
  -e WISPER_API_URL=https://transcription.example.org \
  -e WISPER_WORKER_TOKEN=<token> \
  ghcr.io/nathandelenclos/wisper-worker:latest
```

There are two kinds of tokens: the instance's shared secret (`WORKER_SHARED_TOKEN`, for the
platform's own workers) and a **machine key** a user creates under "My machines". A machine key can
only claim its owner's work, and only what that owner explicitly placed on their machine: it grants
strictly less than the shared secret, and it is revoked without restarting anything.

The image is published by CI on every push to the default branch, after the vulnerability scan passes. It is ~3 GiB — mostly torch and the whisper model runtime — so the first pull takes a while. Build it yourself with `docker build -t wisper-worker ./worker` if you would rather not trust a registry.

## What it does not do

- **The media still goes through the server.** Placing a transcription on your machine changes who
  computes, not who stores: the file is uploaded and kept server-side, then downloaded by the
  worker. This is not end-to-end local processing.
- **No translation.** Whisper transcribes the spoken language; it does not translate.
- **No word-level alignment.** Timecodes are whisper's segment timecodes.

## Architecture in three lines

`apps/api` — NestJS, strict hexagonal architecture: the domain knows nothing about the database,
HTTP or the framework, and the dependency rule is enforced by dependency-cruiser in CI.
`apps/web` — React, Vite, TanStack Query, an in-house design system built on tokens.
`worker/` — framework-free Python: it runs the `whisper` CLI, reads its verbose output as it comes,
and runs a diarisation pass with `sherpa-onnx`.

## Development

```bash
pnpm install
docker run -d --name wisper-dev-pg -e POSTGRES_USER=wisper -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=wisper -p 5432:5432 postgres:17-alpine
pnpm --filter @wisper/api db:migrate
pnpm -r --parallel dev            # API on 3000, front on 5173
```

```bash
cd apps/api && node ./node_modules/vitest/vitest.mjs run   # domain, acceptance, port contracts, throwaway Postgres
python3 -m unittest discover -s worker/tests -t .           # worker, no third-party package needed
docker run --rm -v "$PWD":/w -w /w/apps/api node:24-bookworm-slim \
  node ./node_modules/dependency-cruiser/bin/dependency-cruise.mjs src --config .dependency-cruiser.cjs
```

CI runs all of that, plus a secret scan over the history and a blocking vulnerability scan on the
images that ship.

## Documentation

The [wiki](https://github.com/Nathandelenclos/WisperPlatform/wiki) covers operations: environment
variables, backups, Google sign-in, personal machines, troubleshooting, and the architecture
decisions with the measurements behind them.

## Licence

None yet — no licence file has been added, so default copyright applies and nobody has the right
to reuse this code. If you want people to run their own instance or lend compute, that has to
change: add a `LICENSE` file.
