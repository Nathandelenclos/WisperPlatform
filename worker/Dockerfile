# WisperPlatform transcription worker.
#
# Build context: `worker` (honours `worker/.dockerignore`).
# The worker only talks to the platform over outbound HTTP: it mounts neither the database nor
# the media store, and downloads every media file with a short-lived token.

FROM python:3.12-slim@sha256:2c941e860699f878900b0edc2403613c234d4b32eda3cc9fa7036991a2a63c4a AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore

# Installed torch variant. `cpu` produces an image without the CUDA libraries — three times
# lighter — and `cu124` produces the one that runs on the card.
#
# The choice cannot be left to chance: the default PyPI wheel is built for CUDA 13, which
# requires a driver >= 580 AND dropped Pascal cards. On a host with driver 550 and a
# GTX 1050 Ti (compute 6.1) it installs perfectly well, then announces
# `cuda.is_available() = False`: you think you have a GPU, you transcribe on the CPU.
# CUDA 12.4 covers sm_50 through sm_90, so Pascal included.
ARG TORCH_VARIANT=cpu
ARG TORCH_VERSION=2.6.0

# torch first, from the index of the chosen variant: `openai-whisper` finds its dependency
# already satisfied and will not go fetch the default wheel. The rest comes from PyPI.
# Version pinned so that two builds of the same commit install the same code.
#
# `sherpa-onnx` carries the diarization: a pure 2 MiB wheel, onnxruntime bundled, no
# compilation and no dependency on torch. A worker built without it transcribes exactly as
# before — the pass disables itself at startup.
RUN python -m venv /opt/whisper \
    && /opt/whisper/bin/pip install --no-cache-dir \
         --index-url "https://download.pytorch.org/whl/${TORCH_VARIANT}" \
         "torch==${TORCH_VERSION}" \
    && /opt/whisper/bin/pip install --no-cache-dir openai-whisper==20250625 sherpa-onnx==1.13.6 \
    && /opt/whisper/bin/python -c "import torch, whisper, sherpa_onnx; print('torch', torch.__version__)" \
    && /opt/whisper/bin/pip uninstall -y pip setuptools wheel


# --- Diarization models -----------------------------------------------------------------------
# Throwaway stage: only the two weight files come out of it. Every download is pinned by its
# SHA-256 sum, including the `model.onnx` extracted from the archive — an intact archive could
# perfectly well contain something other than what was measured.
#
# No token, no terms to accept: both weight files come from the public k2-fsa releases.
# Segmentation: pyannote/segmentation-3.0 re-exported to ONNX, MIT licence (CNRS).
# Speaker embedding: 3D-Speaker ERes2Net base, Apache 2.0 licence (Alibaba).
FROM python:3.12-slim@sha256:2c941e860699f878900b0edc2403613c234d4b32eda3cc9fa7036991a2a63c4a AS models

ARG SEGMENTATION_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2
ARG SEGMENTATION_ARCHIVE_SHA256=24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488
ARG SEGMENTATION_MODEL_SHA256=220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079
ARG EMBEDDING_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx
ARG EMBEDDING_SHA256=1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b

# `curl` is used only here and disappears with the stage. The archive is opened by `tarfile`
# rather than by `tar`: the base image already carries Python, it does not carry `bzip2`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && mkdir -p /opt/diarization \
    && curl -fsSL --retry 3 -o /tmp/segmentation.tar.bz2 "${SEGMENTATION_URL}" \
    && echo "${SEGMENTATION_ARCHIVE_SHA256}  /tmp/segmentation.tar.bz2" | sha256sum -c - \
    && python -c "import tarfile; tarfile.open('/tmp/segmentation.tar.bz2').extract('sherpa-onnx-pyannote-segmentation-3-0/model.onnx', '/tmp', filter='data')" \
    && mv /tmp/sherpa-onnx-pyannote-segmentation-3-0/model.onnx /opt/diarization/segmentation.onnx \
    && echo "${SEGMENTATION_MODEL_SHA256}  /opt/diarization/segmentation.onnx" | sha256sum -c - \
    && curl -fsSL --retry 3 -o /opt/diarization/embedding.onnx "${EMBEDDING_URL}" \
    && echo "${EMBEDDING_SHA256}  /opt/diarization/embedding.onnx" | sha256sum -c - \
    && chmod 0444 /opt/diarization/*.onnx


# --- Runtime ----------------------------------------------------------------------------------
FROM python:3.12-slim@sha256:2c941e860699f878900b0edc2403613c234d4b32eda3cc9fa7036991a2a63c4a AS runtime

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="wisper-worker" \
      org.opencontainers.image.source="https://github.com/wisper-platform/wisper-platform" \
      org.opencontainers.image.revision="${VCS_REF}"

# PYTHONUNBUFFERED: without it, `whisper`'s stdout is block-buffered and segment streaming
# does not happen. XDG_CACHE_HOME: the model weights land in a named volume instead of being
# re-downloaded on every startup.
ENV PATH=/opt/whisper/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    XDG_CACHE_HOME=/home/wisper/.cache

# ffmpeg is the only system package added (whisper decodes the media with it). apt stays
# present in `python:*-slim` by construction; pip, setuptools and wheel, however, are removed:
# no Python package manager survives in the final image.
#
# The runtime user has both its UID AND its GID pinned: the compose file imposes
# `user: "10001:10001"`, an auto-assigned GID in the system range would make half of that
# declaration a phantom, and the directories owned below would no longer match.
# `apt-get upgrade` before the install: the upstream image is pinned by digest, but Debian
# publishes its fixes faster than that image is rebuilt (as of 2026-08-22, util-linux there
# carries CVE-2026-53612, already fixed upstream). The CI scan is blocking and a gate is not
# something you work around.
# ponytail: this layer resolves its versions at build time, so it is not reproducible to the
# byte. Way out: go back to the upstream digest alone as soon as it is back to zero HIGH.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/python3.12/site-packages/pip \
              /usr/local/lib/python3.12/site-packages/pip-* \
              /usr/local/lib/python3.12/site-packages/setuptools \
              /usr/local/lib/python3.12/site-packages/setuptools-* \
              /usr/local/lib/python3.12/site-packages/wheel \
              /usr/local/lib/python3.12/site-packages/wheel-* \
              /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.12 \
    && groupadd --system --gid 10001 wisper \
    && useradd --system --create-home --uid 10001 --gid 10001 --shell /usr/sbin/nologin wisper \
    && mkdir -p /home/wisper/.cache/whisper /var/tmp/wisper \
    && chown -R wisper:wisper /home/wisper /var/tmp/wisper

COPY --from=builder --chown=root:root /opt/whisper /opt/whisper
# The diarization weights live in the image, not in a volume: 45 MiB pinned by their checksum
# at build time, which `diarization.py` finds at the default location without configuration.
COPY --from=models --chown=root:root /opt/diarization /opt/diarization

WORKDIR /app
# Worker modules (`wisper_worker.py`, `whisper_output.py`, `api_client.py`,
# `diarization.py`): read-only for the runtime user, no test bundled.
COPY --chown=root:root *.py ./

USER wisper

CMD ["python3", "wisper_worker.py"]
