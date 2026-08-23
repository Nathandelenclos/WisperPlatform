# Workers and machines

A worker is a loop: ask the API for a job, download the media with a short-lived pass, run whisper,
publish segments as they appear, run a diarisation pass, report completion. It holds nothing
afterwards, and it never learns who the user is or what the file was called.

## Run one

```bash
docker run --rm \
  -e WISPER_API_URL=https://transcription.example.org \
  -e WISPER_WORKER_TOKEN=<token> \
  ghcr.io/nathandelenclos/wisper-worker:latest
```

The image is published by CI on every push to the default branch, after its vulnerability scan
passes, tagged `latest` and with the commit sha. It weighs ~3 GiB — torch and the whisper runtime —
so the first pull takes a while; afterwards `docker run` starts in seconds. Building it yourself
stays possible: `docker build -t wisper-worker ./worker`.

Pin the sha tag rather than `latest` if you want a worker that does not change under you:
`ghcr.io/nathandelenclos/wisper-worker:<commit-sha>`.

Useful knobs, all documented in `.env.example`:

| Variable | Default | Why you would touch it |
|---|---|---|
| `WISPER_WORKER_MODELS` | `tiny,base,small,medium` | Only advertise what this machine can actually hold. A model too large for the memory limit gets the process killed by the kernel, with no failure reported. |
| `WISPER_WORKER_ID` | `local-worker` | Shows up in logs and in `claimed_by`. Give each machine its own. |
| `WISPER_DEVICE` | `auto` | `auto` probes for a card and falls back to CPU. The worker announces its decision in its first log line. |
| `WISPER_THREADS` | `0` | 0 derives the count from the container quota, which is almost always right: unbounded, torch opens as many threads as the host has cores while the container only has two, and inference slows down. |
| `POLL_INTERVAL_SECONDS` | `3` | How often an idle worker asks for work. |

## Two kinds of tokens

**The shared secret** (`WORKER_SHARED_TOKEN`) belongs to the instance. A worker holding it is a
platform worker: it is offered any transcription placed on the service, from any user.

**A machine key** belongs to one user, who creates it under "My machines". A worker holding it is
offered **only** that user's work, and **only** what that user explicitly placed on their machine.
It grants strictly less than the shared secret, and it is revoked from the interface without
restarting anything or invalidating anyone else's worker.

Both go in the same place: `WISPER_WORKER_TOKEN`. The worker does not know which kind it holds; the
API resolves it.

## Placement

Every transcription carries a placement:

- `service` (default) — the platform's workers do the work.
- `owner` — only that user's machines do the work.

The queue partitions on the claimant behind the token, in both directions: a service worker is never
offered `owner` work, and a machine key is never offered someone else's work or `service` work. The
rule lives in the queue port's contract and is replayed against the in-memory double **and** real
Postgres, so it cannot quietly rot.

**If the machine is off, the request waits.** It stays pending, says "waiting for your machine", and
no service worker takes it. Handing it to the service is a button, never a timeout: an automatic
fallback would move a media file someone specifically chose to keep at home.

Note what placement does **not** change: the media is still uploaded to and stored by the server.
Placement decides who computes, not who hosts.

## GPU

```bash
docker compose --profile gpu up -d --build
```

Measured on a GTX 1050 Ti (4 GiB, compute 6.1, driver 550), on 52 s of speech:

| Pass | Time | Versus real time |
|---|---|---|
| `small`, 3 CPU threads, fp32 | 5 min 35 s | 6,4x slower |
| `small`, on the card, fp16 | 32 s | 1,6x slower |

Two traps that cost real time here:

- **The default torch wheel does not speak to this card.** PyPI ships a build for CUDA 13, which
  needs driver ≥ 580 and dropped Pascal. It installs fine, `torch.cuda.is_available()` returns
  `False`, and nothing says why. Keep `TORCH_VARIANT=cu124` for anything older.
- **4 GiB of VRAM does not hold `medium`.** In fp16 it wants ~3,9 GiB on a card that has 3,94, and
  it fails at load time, every time. Split by real capacity: the GPU worker takes
  `tiny,base,small`, the CPU worker keeps `medium`.

## When a worker stops

A worker that receives `SIGTERM` **hands its run back**: the request returns to the queue at once,
its attempt still counted so a machine restarting in a loop still exhausts its tries. Before this
existed, a deployment left the transcription marked `transcribing` with nobody on it, waiting two
minutes for the lease to expire, and the partial transcript was thrown away.

A worker that is killed without warning — the kernel's OOM killer, a power cut — cannot report
anything. That is what the lease is for: after `JOB_LEASE_SECONDS` (120 by default) a sweeper puts
the request back in the queue.

## What the user reads when a job fails

"whisper exited with code 1" says nothing, so the tail of stderr is matched against known
signatures:

| What stderr says | What the user is told |
|---|---|
| `torch.OutOfMemoryError: CUDA out of memory` | `model too large for this worker` |
| `no kernel image is available for execution` | `model unsupported by this worker's gpu` |
| `Invalid data found when processing input` | `media could not be decoded` |
| anything else | the raw exit code, for lack of better |

Full diagnostics stay in the container log; only the short reason reaches the user, who should not
have to read a Python traceback to learn they picked the wrong model.
