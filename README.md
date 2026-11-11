# Developer Portfolio

A modular, self-hostable developer portfolio. It is a static Next.js site backed by a NestJS API and
a BullMQ worker, and it is designed to run anywhere: Docker Compose on a laptop, or single-node K3s
with GitOps.

The site is fully static and stays online even when the API host is down. AI features are optional
and provider-agnostic, and they are off by default.

## Stack

| Area      | Choice                                         |
| --------- | ---------------------------------------------- |
| Frontend  | Next.js (static export), React, TypeScript     |
| API       | NestJS on Fastify, versioned REST (`/api/v1`)  |
| Jobs      | BullMQ worker on Redis                         |
| Data      | PostgreSQL with Drizzle migrations             |
| Contracts | Shared TypeScript packages in a pnpm workspace |
| Delivery  | GitHub Actions, GHCR, Helm, Argo CD (planned)  |

## Quick Start

```bash
corepack enable
pnpm install
cp .env.example .env          # replace the change-me values
docker compose up -d          # PostgreSQL + Redis on 127.0.0.1
pnpm db:migrate && pnpm db:seed
pnpm dev:api                  # http://127.0.0.1:3001/api/v1/health
pnpm dev:web                  # http://localhost:3000
```

Or run everything in containers with `docker compose -f compose.full.yaml up -d --build`. Details are
in [docs/deployment/local.md](docs/deployment/local.md).

## Repository Layout

```text
apps/web                    Static Next.js site
apps/api                    NestJS REST API
apps/worker                 BullMQ worker
packages/shared-types       HTTP contracts shared by web and API
packages/project-registry   Validated project and mini-app data
packages/config             Environment validation helpers
packages/ui                 Shared React components
infrastructure/docker       Container images
docs/                       Architecture, deployment, operations
```

## Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Networking](docs/architecture/networking.md) · [Kubernetes](docs/architecture/kubernetes.md) ·
  [AI integration](docs/architecture/ai-integration.md) · [Security](docs/architecture/security.md)
- [Validation register](docs/architecture/validation-register.md)
- [Local deployment](docs/deployment/local.md) · [Kubernetes deployment](docs/deployment/kubernetes.md)
- [Runbooks](docs/operations/runbooks.md)
- [Roadmap and backlog](docs/implementation-roadmap.md)

## Quality Gates

`pnpm check` runs format, lint, typecheck, and unit tests. CI also runs integration tests against
PostgreSQL and Redis, a secret scan, registry signature verification, and container image builds.

## License

[MIT](LICENSE)
