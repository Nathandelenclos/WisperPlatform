# Worker de transcription WisperPlatform.
#
# Contexte de build : `worker` (honore `worker/.dockerignore`).
# Le worker ne parle à la plateforme que par HTTP sortant : il ne monte ni la base, ni le
# magasin de médias, et télécharge chaque média par jeton à durée de vie courte.

FROM python:3.12-slim@sha256:2c941e860699f878900b0edc2403613c234d4b32eda3cc9fa7036991a2a63c4a AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore

# `openai-whisper` tire torch, numba, tiktoken et triton : environ 2,5 à 3 Gio de wheels une
# fois installés — c'est le poids réel de cette étape, et la raison du multi-étapes. Version
# épinglée pour que deux builds du même commit installent le même modèle de code.
RUN python -m venv /opt/whisper \
    && /opt/whisper/bin/pip install --no-cache-dir openai-whisper==20250625 \
    && /opt/whisper/bin/pip uninstall -y pip setuptools wheel


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
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
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

WORKDIR /app
# Modules du worker (`wisper_worker.py`, `whisper_output.py`, `api_client.py`) : lecture seule
# pour l'utilisateur d'exécution, aucun test embarqué.
COPY --chown=root:root *.py ./

USER wisper

CMD ["python3", "wisper_worker.py"]
