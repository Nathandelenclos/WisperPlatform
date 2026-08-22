# Front WisperPlatform.
#
# Contexte de build : `apps/web` (honore `apps/web/.dockerignore`).
# Le contexte nommé `workspace` apporte les manifestes et le lockfile pnpm de la racine.
#
# L'image finale ne contient que des fichiers statiques et nginx : ni Node, ni pnpm, ni Vite.
# Aucune valeur de configuration n'est figée au build : le front appelle l'API en chemin
# relatif `/api`, nginx relaie vers le service `api`. L'image est donc réutilisable telle
# quelle d'un environnement à l'autre.

FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS builder

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

RUN corepack enable pnpm

COPY --from=workspace package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# Manifeste de l'API requis pour que `--frozen-lockfile` retrouve tous les projets du lockfile.
COPY --from=workspace apps/api/package.json ./apps/api/
COPY package.json ./apps/web/

RUN pnpm install --frozen-lockfile --filter @wisper/web

# Sources du front (le build a besoin de `index.html`, `src/`, `vite.config.ts`, `tsconfig.json`).
COPY . ./apps/web/

RUN pnpm --filter @wisper/web build


# --- Runtime ----------------------------------------------------------------------------------
# nginx non privilégié : le processus tourne en uid 101, écoute sur 8080, sans capacité root.
FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6 AS runtime

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="wisper-web" \
      org.opencontainers.image.source="https://github.com/wisper-platform/wisper-platform" \
      org.opencontainers.image.revision="${VCS_REF}"


# L'image amont est épinglée par digest, mais Alpine publie des correctifs plus vite qu'elle
# n'est reconstruite : au 2026-08-22 son jeu de paquets porte dix vulnérabilités HIGH déjà
# corrigées en amont (c-ares, curl/libcurl, libcrypto3/libssl3). Le scan de la CI est bloquant,
# et une gate ne se contourne pas : on applique les correctifs de paquets ici.
# ponytail: `apk upgrade` résout au moment du build, donc cette couche n'est pas reproductible
# à l'octet. Sortie : revenir au seul digest amont dès qu'il repasse à zéro HIGH.
USER root
RUN apk --no-cache upgrade
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

USER nginx
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
