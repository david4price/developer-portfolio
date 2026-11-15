# syntax=docker/dockerfile:1
# Builds one Node.js service from the workspace. APP selects the app directory: api | worker.
# Debian slim (glibc) rather than Alpine: the API's injection classifier runs on onnxruntime-node,
# whose prebuilt native binaries need glibc.
ARG NODE_IMAGE=node:24-trixie-slim

FROM ${NODE_IMAGE} AS build
ARG APP
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo
RUN corepack enable
COPY . .
# onnxruntime-node ships binaries for every OS and CPU; keep only this image's.
RUN test -n "${APP}" \
  && pnpm install --frozen-lockfile --filter "@portfolio/${APP}..." \
  && pnpm exec tsc -b "apps/${APP}" \
  && pnpm --filter "@portfolio/${APP}" deploy --prod /out \
  && arch="$(node -p process.arch)" \
  && find /out/node_modules -type d -name napi-v6 -path '*onnxruntime-node*' -prune \
    -exec sh -c 'for d in "$1"/*/*; do [ "$d" = "$1/linux/$2" ] || rm -rf "$d"; done' sh {} "${arch}" \;

# The chat's injection classifier (P5-08), pinned by revision and checked by SHA-256. A separate
# stage, so the download is cached until the pins change; the worker gets an empty directory.
FROM ${NODE_IMAGE} AS models
ARG APP
COPY apps/api/scripts/fetch-injection-classifier.mjs /tmp/fetch-injection-classifier.mjs
RUN mkdir -p /models \
  && if [ "${APP}" = api ]; then \
    node /tmp/fetch-injection-classifier.mjs /models/injection-classifier; \
  fi

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=root:root /out ./
COPY --from=models --chown=root:root /models ./models
USER node
CMD ["node", "dist/main.js"]
