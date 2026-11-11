# syntax=docker/dockerfile:1
# Static export served by unprivileged nginx on port 8080.
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS build
ARG NEXT_PUBLIC_API_BASE_URL
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  NEXT_TELEMETRY_DISABLED=1 \
  NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@portfolio/web..." \
  && pnpm exec tsc -b packages/ui packages/project-registry \
  && pnpm --filter @portfolio/web build

FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime
COPY infrastructure/docker/web.nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/out /usr/share/nginx/html
EXPOSE 8080
