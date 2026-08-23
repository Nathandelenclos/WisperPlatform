# Troubleshooting

Every entry below is a failure that actually happened on a running instance, with its root cause —
not a symptom checklist.

## Every `/api/…` call returns 502, the SPA loads fine

**Cause.** On a host running several stacks on a shared Docker network, the service name `api` also
exists in a neighbour's stack, and Docker's DNS resolved nginx's upstream to *someone else's*
container. The symptom was `connect() failed (111: Connection refused) while connecting to upstream
10.0.1.196:3000` while our API sat at another address.

**Why it is worse than it looks.** `postgres` is at least as common a name. The API could have
written into a neighbour's database without a single error.

**Fix.** Services carry the stack prefix in their own names (`wisper-api`, `wisper-postgres`), and
the stack is detached from any shared network except the one the reverse proxy needs. If you hit
this, check what `docker exec <web> getent hosts api` resolves to before suspecting your config.

## The GPU worker starts but runs on the CPU

**Cause.** The torch wheel from PyPI is built for CUDA 13, which requires driver ≥ 580 and dropped
Pascal cards. It installs perfectly, `torch.cuda.is_available()` returns `False`, and nothing
explains why.

**Fix.** `TORCH_VARIANT=cu124`. Verify on the card itself, not from the host:

```bash
docker run --rm --gpus all --entrypoint /opt/whisper/bin/python wisper-worker \
  -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

## A job fails with `model too large for this worker`

The card cannot hold that model. On 4 GiB of VRAM, `medium` wants ~3,9 GiB in fp16 and fails at load
time. Advertise `tiny,base,small` on that worker and leave `medium` to a CPU worker with a
comfortable memory limit.

## A transcription stays `transcribing` with nobody working on it

Its worker died without reporting. After `JOB_LEASE_SECONDS` (120 by default) a sweeper puts it back
in the queue, and each attempt counts against `JOB_MAX_ATTEMPTS` (3).

If this happens on every deployment, the worker is being killed rather than asked to stop: a worker
that receives `SIGTERM` hands its run back immediately instead of letting the lease expire.

## A transcription stays `pending` forever

Two possibilities, and they look identical in the list:

- **No worker advertises its model.** Check what your workers announce in their first log line.
- **It is placed on a machine that is off.** The interface says "waiting for your machine" and offers
  to hand it to the service. This is deliberate: nothing moves a media file that someone chose to
  keep at home without them asking.

## The first job of a model takes forever

It is downloading the model weights: 28 s for `tiny`, several minutes for `medium`. The weights live
in a named volume, so it happens once per worker, not once per job.

## Speaker labels never appear

In order of likelihood:

1. **The worker has no diarisation capability.** It says so once at startup — grep its log for
   `diarization`. A missing weight or an unreadable setting disables the pass with one info line
   rather than failing the job.
2. **The media is longer than four hours.** Past that cap the pass is skipped on purpose, because the
   memory it would need gets the container killed and would lose a transcript that had succeeded.
3. **Everything landed in one cluster.** Set `WISPER_DIARIZATION_MAX_SPEAKERS` if you know the count,
   or lower `WISPER_DIARIZATION_CLUSTER_THRESHOLD`. See [Diarisation](Diarisation).

Speakers arrive at the very end of a job, not with the segments: the pass needs the whole file.

## A worker loops on 401

Its token is not accepted. Either the shared secret was rotated on the API without restarting the
workers — they must be restarted together, which is why `.env` holds that secret under one name only
— or the machine key it carries has been revoked. The API answers the same way in both cases, on
purpose: nothing should let a caller tell "wrong shared secret" from "revoked key".

## An upload returns 413

`MEDIA_MAX_BYTES` (2 GiB by default) is enforced by the API *and* by the nginx in front of it. A
reverse proxy of your own with a smaller body limit turns every large upload into a 413 before it
ever reaches the platform.

## The live transcript stops updating

The SSE stream died and the client reconnects with bounded backoff; after five attempts it says so
and falls back to periodic refetching, so the view still reaches the end state. If it happens
systematically, your reverse proxy is buffering: `/api/transcriptions/:id/events` needs buffering off
and a long read timeout.

## "My machines" says a machine was never seen, but it is running

It refreshes every thirty seconds and on tab focus. If it still says so after that, the worker is not
reaching the API at all — check its logs for `claim failed`.
