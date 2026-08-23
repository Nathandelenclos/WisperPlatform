# WisperPlatform front end.
#
# Build context: `apps/web` (honours `apps/web/.dockerignore`).
# The context named `workspace` brings the manifests and the pnpm lockfile from the root.
#
# The final image holds nothing but static files and nginx: no Node, no pnpm, no Vite.
# No configuration value is frozen at build time: the front end calls the API through the
# relative path `/api`, and nginx relays to the `api` service. The image is therefore reusable
# as it stands from one environment to the next.

FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS builder

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

RUN corepack enable pnpm

COPY --from=workspace package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# The API manifest is required for `--frozen-lockfile` to find every project of the lockfile.
COPY --from=workspace apps/api/package.json ./apps/api/
COPY package.json ./apps/web/

RUN pnpm install --frozen-lockfile --filter @wisper/web

# Front-end sources (the build needs `index.html`, `src/`, `vite.config.ts`, `tsconfig.json`).
COPY . ./apps/web/

RUN pnpm --filter @wisper/web build


# --- Runtime ----------------------------------------------------------------------------------
# Unprivileged nginx: the process runs as uid 101, listens on 8080, with no root capability.
FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6 AS runtime

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="wisper-web" \
      org.opencontainers.image.source="https://github.com/wisper-platform/wisper-platform" \
      org.opencontainers.image.revision="${VCS_REF}"


# The upstream image is pinned by digest, but Alpine publishes fixes faster than that image is
# rebuilt: as of 2026-08-22 its package set carries ten HIGH vulnerabilities already fixed
# upstream (c-ares, curl/libcurl, libcrypto3/libssl3). The CI scan is blocking, and a gate is
# not to be worked around: the package fixes are applied here.
# ponytail: `apk upgrade` resolves at build time, so this layer is not byte-reproducible.
# Way out: go back to the upstream digest alone as soon as it returns to zero HIGH.
USER root
RUN apk --no-cache upgrade
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

USER nginx
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
