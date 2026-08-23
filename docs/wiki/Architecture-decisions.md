# Architecture decisions

Why the code is shaped this way, with what was measured to decide. Each entry is a decision that
would be expensive to reverse.

## The domain owns the rules, the infrastructure owns nothing

`apps/api` follows hexagonal architecture, and it is not a preference: `dependency-cruiser` fails the
build if `domain/` imports anything outward, or if `application/` reaches for infrastructure. Ports
are declared by the application in business terms; adapters implement them in `infrastructure/`.

What that buys, concretely: the assignment rule that gives each segment a speaker is one function,
tested without audio, a database or HTTP. The same port contract is replayed against the in-memory
double **and** real Postgres, so the two can never drift.

## An optimistic lock, because two writers really do collide

Corrections and worker batches write to the same aggregate. Without a version column, the second
write silently overwrote the first — a user's correction disappearing under a batch of segments.

Every aggregate carries `version`; a write that loaded version N refuses to overwrite N+1, and the
caller retries on a fresh read. Real collisions are brief and benign; the retry makes them invisible.

## Media passes are HMAC tokens, not database rows

A worker downloading a media file presents a signed token carrying the transcription, the run and an
expiry. It is verified by signature, not by lookup: no table, no cleanup, nothing to leak. It names
one transcription and one run — the worker learns nothing about the user, not even the file name.

## Diarisation runs on ONNX, without a token

`sherpa-onnx` plus two ONNX weights (pyannote segmentation re-exported, MIT; 3D-Speaker ERes2Net,
Apache-2.0), 45 MiB total, no torch, **no HuggingFace account**. `pyannote.audio` is the reference of
the field and was rejected for exactly one reason: its pipelines are gated, and a volunteer worker
operator cannot be asked to create an account and hold a third-party secret. WhisperX would have
replaced the whisper CLI the project is built on and added ~1 GiB of alignment models per language,
while still calling pyannote.

Measured: 0,060x real time on two CPU threads, ~255 MiB of RSS. Correct separation of three real
human voices in automatic clustering. See [Diarisation](Diarisation) for the calibration caveat.

## The worker publishes turns, the API assigns speakers

The worker sends raw turns; the aggregate decides which speaker each segment gets, by largest
temporal overlap, ties to the lowest index. One rule, one place, testable without audio — and a
replayed publication produces the same result, which matters because delivery is at-least-once.

## A machine key grants strictly less than the shared secret

Users bind their own machine with a key: 256 bits of randomness, stored only as a SHA-256
fingerprint (a plain hash, because nothing guesses 256 bits from a dictionary and the lookup must be
one indexed query). The plaintext exists once, in the creation response.

A key can only claim its owner's work, and only what that owner explicitly placed on their machine.
The queue partitions in both directions, and that rule lives in the port contract. A leaked key is
therefore less dangerous than today's shared secret, and it is revoked without restarting anything.

## Waiting is a state, not a failure

A transcription placed on a machine that is off stays pending and says so. Handing it to the service
is a gesture, never a timeout: an automatic fallback would move a media file someone specifically
chose to keep at home.

## What placement does not change

The media is uploaded to and stored by the server, then downloaded by the worker. Placement decides
who computes, not who hosts. This is not end-to-end local processing, and the interface is written so
nobody can believe otherwise.

## Migrations are additive, and run before the API

Versioned files, applied by a dedicated service that completes before the API starts — never at
application startup, where several instances would race. Additive by policy, so old and new code can
run together during a rolling deployment. Destructive changes take two deployments.

## The interface is built on tokens, and contrast is measured

Colour, space, type and motion live in tokens, in a light and a dark theme. 34 text, border,
focus-ring and status pairs are measured against their own background; none is below its WCAG 2.2
threshold, the tightest at 3,37:1 on the control border. Status never rests on colour alone: a tone,
a distinct shape and a written label.

## Tests defend behaviour, not structure

Acceptance tests enter through the use case with in-memory doubles. Port contracts run against every
adapter. Domain specs cover invariants. The worker's own suite runs on a bare interpreter with no
third-party package — which is why reading a decoded WAV hands back raw frames and the numpy
conversion sits behind its own seam.
