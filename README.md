# Developer Portfolio

A modular, self-hostable developer portfolio. It is a static Next.js site backed by a NestJS API and
a BullMQ worker, and it is designed to run anywhere: Docker Compose on a laptop, or single-node K3s
with GitOps.

The site is fully static and stays online even when the API host is down. AI features are optional
and provider-agnostic, and they are off by default.

The resting dog opens a comic-style Portfolio Assistant speech bubble over any page. It sits while
chat is open, stands while waiting for a reply, and lies down again when closed. When AI is enabled, session creation
requires server-verified Turnstile tokens; without its public build configuration the page reports
"not configured" and the rest of the site works. Production setup and browser acceptance remain
pending. See the
[Turnstile setup guide](docs/deployment/turnstile.md) for configuration and deployment status.

**Progress and next steps:** [docs/implementation-roadmap.md](docs/implementation-roadmap.md)
(start at "Resume Here").

The Infrastructure Explorer prototype uses sample data. Its optional API source reads only
allowlisted workload facts and, with an Application-scoped Argo CD token, the deployed GitOps
revision and sync status. Normal local development needs neither Kubernetes nor Argo CD;
see [Explorer configuration](docs/deployment/local.md).

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
packages/project-registry   Validated projects, mini-apps, profile, chat notes
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
- [Local deployment](docs/deployment/local.md) · [Kubernetes deployment](docs/deployment/kubernetes.md) ·
  [Cloudflare Pages](docs/deployment/cloudflare-pages.md)
- [Runbooks](docs/operations/runbooks.md)
- [Roadmap checklist](docs/implementation-roadmap.md)

## Quality Gates

`pnpm check` runs format, lint, typecheck, and unit tests. CI also runs integration tests against
PostgreSQL and Redis, a secret scan, registry signature verification, and container image builds.

## License

[MIT](LICENSE)
