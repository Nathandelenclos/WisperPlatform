# Contributing

## Get it running

```bash
pnpm install
docker run -d --name wisper-dev-pg -e POSTGRES_USER=wisper -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=wisper -p 5432:5432 postgres:17-alpine
cp .env.example .env   # then fill the three secrets, see Self-hosting
pnpm --filter @wisper/api db:migrate
pnpm -r --parallel dev            # API on 3000, front on 5173
```

A worker against your local API, with the shared secret from your `.env`:

```bash
docker build -t wisper-worker ./worker
docker run --rm --network host \
  -e WISPER_API_URL=http://localhost:3000 \
  -e WISPER_WORKER_TOKEN=<WORKER_SHARED_TOKEN> \
  wisper-worker
```

## Run the checks

```bash
cd apps/api
node ./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node ./node_modules/vitest/vitest.mjs run          # domain, acceptance, port contracts, throwaway Postgres
```

```bash
cd apps/web
node ./node_modules/typescript/bin/tsc -b . --noEmit --force
```

```bash
python3 -m unittest discover -s worker/tests -t .   # from the repository root, no third-party package
```

```bash
docker run --rm -v "$PWD":/w -w /w/apps/api node:24-bookworm-slim \
  node ./node_modules/dependency-cruiser/bin/dependency-cruise.mjs src --config .dependency-cruiser.cjs
```

CI runs all of it, cheapest first, plus a secret scan over the history and a blocking vulnerability
scan on the images that ship. Nothing is allowed to fail: every step presented as a barrier really
blocks the merge.

## Conventions

**English everywhere in the repository** — code, identifiers, comments, test names, documentation,
commit messages. (Parts of the tree still carry French comments and test names from earlier work;
they are being translated. New code does not add more.)

**Conventional Commits**, one coherent change per commit. The body explains what was wrong and why
this fixes it, not what the diff shows.

**Hexagonal architecture is enforced, not suggested.** `domain/` imports nothing outward, `application/`
knows only ports, adapters live in `infrastructure/`. If a dependency needs to point outward, invert
it with a port. `dependency-cruiser` will tell you before the reviewer does.

**Test-first, outside-in.** Start from an acceptance test through the use case with in-memory
doubles, then descend. A port gains a contract suite replayed against every adapter — in-memory and
real — so they cannot drift.

**No raw values in CSS.** Colour, space, radius, shadow and duration come from the tokens in
`apps/web/src/styles/tokens.css`. A component that needs a value that does not exist adds the token.

**Status never rests on colour alone** (WCAG 1.4.1), and any new text/background pair is measured,
not eyeballed.

**Ask before adding a dependency.** Standard library first, then a platform feature, then something
already installed.

## Where things live

| Path | What it is |
|---|---|
| `apps/api/src/<context>/domain` | Aggregates, value objects, domain events, invariants. No framework, no ORM. |
| `apps/api/src/<context>/application` | Ports and use cases. Orchestration, never deep invariants. |
| `apps/api/src/<context>/infrastructure` | Adapters: Drizzle, filesystem, HMAC, clock, uuid. |
| `apps/api/src/<context>/interface/http` | Thin controllers, zod validation, guards. |
| `apps/api/test/acceptance` | Business scenarios through the use case. |
| `apps/api/test/contracts` | Port contracts, replayed on doubles and on real adapters. |
| `apps/api/drizzle` | Versioned migrations. Never edited after being applied. |
| `apps/web/src/components/primitives` | The nine building blocks. Contrast-audited; change them deliberately. |
| `worker/` | The worker: whisper invocation, verbose output parsing, diarisation pass. |

## Sending a patch

Green tests before any commit. A PR describes what, why, impact, tests and risks — not a diary. If
your change alters observable behaviour, say what you ran to prove it: the test, the command, or the
browser walk-through.
