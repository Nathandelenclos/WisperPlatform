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

# Les devDependencies sont retirées du MANIFESTE avant l'installation, et pas seulement écartées
# par `--prod` : `better-auth` déclare `vitest` et `drizzle-kit` en pairs optionnels, donc tant
# qu'elles figurent dans le manifeste pnpm résout ces arêtes et matérialise leurs binaires
# esbuild (0.18.20, 0.25.12, 0.28.2) dans le magasin virtuel, que `--prod` recopiait ensuite en
# entier — c'est de là que venaient toutes les vulnérabilités HIGH/CRITICAL de la Go stdlib
# relevées par Trivy. `pnpm deploy` rend un `node_modules` autonome, recopiable tel quel dans
# l'étape runtime : plus de liens relatifs à entretenir entre deux répertoires. `--legacy` est
# exigé par pnpm 11 hors `inject-workspace-packages`, que cet espace de travail n'active pas.
# ponytail: le manifeste amputé désaccorde le lockfile, donc cette étape résout au lieu de
# figer (`--no-frozen-lockfile`). Vérifié : les 159 paquets installés portent exactement les
# versions du lockfile — les spécificateurs de production sont inchangés, seuls les suffixes de
# pairs bougent — et l'étape `builder` reste figée. Sortie : `pnpm.overrides` sur les pairs
# optionnels de `better-auth` dans `apps/api/package.json`, ou un pnpm qui ignore les pairs
# optionnels sous `--prod` ; les deux sont hors de ce correctif.

# Le manifeste est amputé de ses devDependencies avant toute résolution, puis `pnpm deploy`
# produit `/deploy` : un projet autonome portant son `package.json` et son `node_modules`.
RUN node -e "const fs=require('node:fs');const p='./apps/api/package.json';const m=JSON.parse(fs.readFileSync(p,'utf8'));delete m.devDependencies;fs.writeFileSync(p, JSON.stringify(m,null,2)+'\n');" \
 && pnpm install --no-frozen-lockfile --prod --ignore-scripts --filter @wisper/api \
 && pnpm --filter @wisper/api deploy --legacy --prod --ignore-scripts /deploy \
 && test -f /deploy/package.json && test -d /deploy/node_modules


# --- Runtime ----------------------------------------------------------------------------------
FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS runtime

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="wisper-api" \
      org.opencontainers.image.source="https://github.com/wisper-platform/wisper-platform" \
      org.opencontainers.image.revision="${VCS_REF}"

ENV NODE_ENV=production

# Aucun gestionnaire de paquets dans l'image finale — yarn compris, que l'image `node` livre
# hors de `node_modules` et que Trivy voyait encore. `media-store` est créé et attribué ici
# pour qu'un volume neuf hérite de la bonne propriété : la racine du conteneur est montée en
# lecture seule, et les envois multipart transitent par `media-store/incoming`.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && mkdir -p /app/media-store \
    && chown node:node /app/media-store

WORKDIR /app/apps/api

# `node_modules` autonome produit par `pnpm deploy` : magasin virtuel et liens de premier
# niveau vivent dans le même répertoire, une seule copie suffit.
COPY --from=production-deps --chown=node:node /deploy/node_modules ./node_modules
COPY --from=production-deps --chown=node:node /deploy/package.json ./package.json
COPY --from=builder --chown=node:node /app/apps/api/dist ./dist
COPY --from=builder --chown=node:node /app/apps/api/drizzle ./drizzle

USER node
EXPOSE 3000

CMD ["node", "dist/main.js"]
