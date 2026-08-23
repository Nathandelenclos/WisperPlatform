# Worker de transcription WisperPlatform.
#
# Contexte de build : `worker` (honore `worker/.dockerignore`).
# Le worker ne parle à la plateforme que par HTTP sortant : il ne monte ni la base, ni le
# magasin de médias, et télécharge chaque média par jeton à durée de vie courte.

FROM python:3.12-slim@sha256:2c941e860699f878900b0edc2403613c234d4b32eda3cc9fa7036991a2a63c4a AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore

# Variante de torch installée. `cpu` produit une image sans les bibliothèques CUDA — trois fois
# plus légère — et `cu124` produit celle qui tourne sur la carte.
#
# Le choix ne peut pas être laissé au hasard : la roue par défaut de PyPI est compilée pour
# CUDA 13, qui exige un pilote >= 580 ET a laissé tomber les cartes Pascal. Sur un hôte au
# pilote 550 avec une GTX 1050 Ti (compute 6.1), elle s'installe très bien puis annonce
# `cuda.is_available() = False` : on croit avoir un GPU, on transcrit sur le processeur.
# CUDA 12.4 couvre sm_50 à sm_90, donc Pascal inclus.
ARG TORCH_VARIANT=cpu
ARG TORCH_VERSION=2.6.0

# torch d'abord, depuis l'index de la variante choisie : `openai-whisper` trouve sa dépendance
# déjà satisfaite et n'ira pas chercher la roue par défaut. Le reste vient de PyPI.
# Version épinglée pour que deux builds du même commit installent le même modèle de code.
#
# `sherpa-onnx` porte la diarisation : roue pure de 2 Mio, onnxruntime embarqué, aucune
# compilation et aucune dépendance sur torch. Un worker construit sans elle transcrit
# exactement comme avant — la passe se désactive toute seule au démarrage.
RUN python -m venv /opt/whisper \
    && /opt/whisper/bin/pip install --no-cache-dir \
         --index-url "https://download.pytorch.org/whl/${TORCH_VARIANT}" \
         "torch==${TORCH_VERSION}" \
    && /opt/whisper/bin/pip install --no-cache-dir openai-whisper==20250625 sherpa-onnx==1.13.6 \
    && /opt/whisper/bin/python -c "import torch, whisper, sherpa_onnx; print('torch', torch.__version__)" \
    && /opt/whisper/bin/pip uninstall -y pip setuptools wheel


# --- Modèles de diarisation -------------------------------------------------------------------
# Étape jetable : seuls les deux poids en sortent. Chaque téléchargement est figé par sa somme
# SHA-256, y compris le `model.onnx` extrait de l'archive — une archive intègre pourrait très
# bien contenir autre chose que ce qui a été mesuré.
#
# Ni jeton, ni condition à accepter : les deux poids viennent des releases publiques de k2-fsa.
# Segmentation : pyannote/segmentation-3.0 réexporté en ONNX, licence MIT (CNRS).
# Empreinte de locuteur : 3D-Speaker ERes2Net base, licence Apache 2.0 (Alibaba).
FROM python:3.12-slim@sha256:2c941e860699f878900b0edc2403613c234d4b32eda3cc9fa7036991a2a63c4a AS models

ARG SEGMENTATION_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2
ARG SEGMENTATION_ARCHIVE_SHA256=24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488
ARG SEGMENTATION_MODEL_SHA256=220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079
ARG EMBEDDING_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx
ARG EMBEDDING_SHA256=1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b

# `curl` ne sert qu'ici et disparaît avec l'étape. L'archive est ouverte par `tarfile` plutôt
# que par `tar` : l'image de base porte déjà Python, elle ne porte pas `bzip2`.
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

# PYTHONUNBUFFERED : sans lui, stdout de `whisper` est tamponné par blocs et le streaming des
# segments n'a pas lieu. XDG_CACHE_HOME : les poids de modèle atterrissent dans un volume nommé
# au lieu d'être retéléchargés à chaque démarrage.
ENV PATH=/opt/whisper/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    XDG_CACHE_HOME=/home/wisper/.cache

# ffmpeg est le seul paquet système ajouté (whisper décode le média avec lui). apt reste présent
# dans `python:*-slim` par construction ; en revanche pip, setuptools et wheel sont retirés :
# aucun gestionnaire de paquets Python ne survit dans l'image finale.
#
# L'utilisateur d'exécution a son UID ET son GID épinglés : le compose impose
# `user: "10001:10001"`, un GID auto-attribué dans la plage système rendrait la moitié de cette
# déclaration fantôme, et les répertoires attribués ci-dessous ne correspondraient plus.
# `apt-get upgrade` avant l'installation : l'image amont est épinglée par digest, mais Debian
# publie ses correctifs plus vite qu'elle n'est reconstruite (au 2026-08-22, util-linux y porte
# CVE-2026-53612, déjà corrigée en amont). Le scan de la CI est bloquant et une gate ne se
# contourne pas.
# ponytail: cette couche résout ses versions au moment du build, donc elle n'est pas
# reproductible à l'octet. Sortie : revenir au seul digest amont dès qu'il repasse à zéro HIGH.
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
# Les poids de diarisation sont dans l'image, pas dans un volume : 45 Mio figés par leur
# somme au build, que `diarization.py` trouve à l'emplacement par défaut sans configuration.
COPY --from=models --chown=root:root /opt/diarization /opt/diarization

WORKDIR /app
# Modules du worker (`wisper_worker.py`, `whisper_output.py`, `api_client.py`,
# `diarization.py`) : lecture seule pour l'utilisateur d'exécution, aucun test embarqué.
COPY --chown=root:root *.py ./

USER wisper

CMD ["python3", "wisper_worker.py"]
