# API WisperPlatform.
#
# Contexte de build : `apps/api` (honore `apps/api/.dockerignore`).
# Le contexte nommé `workspace` apporte les fichiers de l'espace de travail pnpm situés à la
# racine du dépôt (manifestes + lockfile), sans élargir le contexte principal.
#
# Base : `node:24-bookworm-slim`, ligne LTS active au 2026-08-22 (même digest que le tag
# `node:lts-bookworm-slim` à cette date), épinglée par version ET digest.
# Multi-étapes : ni pnpm, ni TypeScript, ni devDependency ne survivent dans l'image finale.

FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS workspace-base

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

# pnpm est activé par corepack à la version épinglée dans le champ `packageManager` de la racine.
RUN corepack enable pnpm

# Manifestes et lockfile d'abord : l'installation n'est réinvalidée que s'ils changent.
COPY --from=workspace package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# Le manifeste de `apps/web` est requis pour que `--frozen-lockfile` retrouve tous les projets
# déclarés dans le lockfile, même si l'on n'installe que l'API.
COPY --from=workspace apps/web/package.json ./apps/web/
COPY package.json ./apps/api/


# --- Compilation TypeScript -------------------------------------------------------------------
FROM workspace-base AS builder

RUN pnpm install --frozen-lockfile --filter @wisper/api

COPY tsconfig.json tsconfig.build.json ./apps/api/
COPY src ./apps/api/src
# Migrations versionnées : jouées par le service `migrate` du compose, jamais au démarrage.
COPY drizzle ./apps/api/drizzle

RUN pnpm --filter @wisper/api build


# --- Dépendances de production ----------------------------------------------------------------
FROM workspace-base AS production-deps

# `--prod` écarte les devDependencies, `--ignore-scripts` interdit l'exécution de scripts
# d'installation : rien n'est compilé ici, donc rien de compilé n'entre dans l'image finale.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @wisper/api


# --- Runtime ----------------------------------------------------------------------------------
FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS runtime

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="wisper-api" \
      org.opencontainers.image.source="https://github.com/wisper-platform/wisper-platform" \
      org.opencontainers.image.revision="${VCS_REF}"

ENV NODE_ENV=production

# Aucun gestionnaire de paquets dans l'image finale. `media-store` est créé et attribué ici
# pour qu'un volume neuf hérite de la bonne propriété : la racine du conteneur est montée en
# lecture seule, et les envois multipart transitent par `media-store/incoming`.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    && mkdir -p /app/media-store \
    && chown node:node /app/media-store

WORKDIR /app/apps/api

# node_modules de l'espace de travail pnpm : le magasin virtuel vit à la racine, les liens
# relatifs de `apps/api/node_modules` restent valides parce que l'arborescence est identique.
COPY --from=production-deps --chown=node:node /app/node_modules /app/node_modules
COPY --from=production-deps --chown=node:node /app/apps/api/node_modules ./node_modules
COPY --from=production-deps --chown=node:node /app/apps/api/package.json ./package.json
COPY --from=builder --chown=node:node /app/apps/api/dist ./dist
COPY --from=builder --chown=node:node /app/apps/api/drizzle ./drizzle

USER node
EXPOSE 3000

CMD ["node", "dist/main.js"]
