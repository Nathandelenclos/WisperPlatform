# Diarisation

Diarisation answers "who speaks when": it cuts the audio into turns and groups the ones that come
from the same voice. Speakers show up as `Locuteur 1`, `Locuteur 2`… until someone renames them, and
the name then follows into SRT, VTT and plain text.

## What it runs on

`sherpa-onnx`, with two ONNX weights baked into the worker image:

| Piece | Size | Licence |
|---|---|---|
| `sherpa-onnx` wheel (onnxruntime included, no torch) | 2,1 MiB | Apache-2.0 |
| pyannote segmentation 3.0, re-exported to ONNX | 7,2 MiB | MIT (CNRS) |
| 3D-Speaker ERes2Net speaker embedding | 38 MiB | Apache-2.0 |

**No HuggingFace token, no conditions to accept, no account.** That is the whole reason this stack
was chosen over `pyannote.audio`, whose pipelines are gated: a volunteer worker operator cannot be
asked to create an account and hold a third-party secret. WhisperX was ruled out too — it replaces
the whisper CLI this project is built around and pulls ~1 GiB of per-language alignment models,
while still calling pyannote for diarisation.

## What it costs

Measured on an Apple M4, two threads:

| Fixture | Wall time | Versus real time |
|---|---|---|
| 57 s, four speakers (k2-fsa reference) | 1,54 s | 0,027x |
| 31 s, three real human voices | 1,86 s | 0,060x |

About 255 MiB of RSS while it runs, and +45 MiB of image. Next to a whisper pass at ~6x slower than
real time on the same CPU, diarisation is free.

## How it fits into a job

It runs **after** whisper and **before** the job is reported complete, so the lease keeps being
renewed across it. It cannot cost you a transcript: any failure is one warning line and the job
still completes with its text. A worker without the weights says so once at startup and transcribes
exactly as before.

It needs the whole file, so speakers arrive **at the end**, in one go, while segments keep streaming
live. The interface says so rather than looking stuck.

The worker publishes raw turns — start, end, a clustering index — and the API decides which speaker
each segment gets: the one whose turns cover the largest share of the segment, ties going to the
lowest index so the result never depends on the order turns arrive in. A segment nothing covers keeps
no speaker rather than borrowing a neighbour's.

## Tuning how many speakers you get

Two variables, both optional:

| Variable | Default | Effect |
|---|---|---|
| `WISPER_DIARIZATION_CLUSTER_THRESHOLD` | `0.5` | Higher merges close voices into one; lower splits one voice into several. |
| `WISPER_DIARIZATION_MAX_SPEAKERS` | `-1` (automatic) | Set it to the real count when you know it — the result is markedly better than letting the clustering guess. |

Measured on the four-speaker reference recording: `0.5` finds seven speakers, `0.8` finds five, `1.0`
finds three, and forcing four gives four clean ones. **The value cannot be guessed** — calibrate it
on your own recordings, or set the count when you know it.

Two more knobs exist and rarely need touching: `WISPER_DIARIZATION_THREADS` (2) and the model paths,
which already point at the weights inside the image.

## Limits worth knowing

- **Media longer than four hours is not diarised.** The pass materialises the whole signal in memory
  — roughly 576 MiB per hour of audio at peak — and a container that exceeds its memory limit is
  killed by the kernel with no chance to report anything, which would lose a transcript that had
  already succeeded. Past the cap the pass is skipped and the transcription completes normally.
- **Synthetic voices do not separate.** macOS `say` voices embed too close to each other; that is a
  bad fixture, not a broken pipeline. Judge quality on real recordings.
- **A speaker index is not a person.** It is stable within one transcription and means nothing
  across two. Renaming applies to one transcription.
- **A voice print is biometric data.** It never leaves the worker: it is neither transmitted nor
  stored. Only time bounds and an index travel. The name you give a speaker stays with the
  transcription's owner, never with the worker.
