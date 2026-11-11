# syntax=docker/dockerfile:1
# Builds one Node.js service from the workspace. APP selects the app directory: api | worker.
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS build
ARG APP
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo
RUN corepack enable
COPY . .
RUN test -n "${APP}" \
  && pnpm install --frozen-lockfile --filter "@portfolio/${APP}..." \
  && pnpm exec tsc -b "apps/${APP}" \
  && pnpm --filter "@portfolio/${APP}" deploy --prod /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=root:root /out ./
USER node
CMD ["node", "dist/main.js"]
