# Architecture Overview

Status labels used throughout these documents:

- **Confirmed**: verified against the reference deployment or implemented in this repository.
- **Proposed**: the intended design, not yet implemented or validated.
- **Unknown**: information still missing; see the [validation register](validation-register.md).

## Goals

A public developer portfolio that doubles as a working demonstration of full-stack, platform, and
operations engineering. Anyone can clone it and run it without the original author's homelab, AI
model, or Cloudflare account.

## Logical Architecture

```text
                         INTERNET
                            |
                    Cloudflare edge (CDN / TLS / WAF)
                            |
             +--------------+---------------+
             |                              |
   Static Next.js site               Cloudflare Tunnel (outbound only)
   (Cloudflare Pages)                       |
             |                              |
             +------ HTTPS REST (/api/v1) --+
                                            |
                                   Reference home server
                                            |
                                     K3s (single node)
                                            |
                                    API Service (ClusterIP)
                                            |
                              NestJS API  (HPA, stateless)
                                            |
               +----------------------------+------------------+
               |                            |                  |
          PostgreSQL                      Redis           AI provider port
        (portfolio-owned)        sessions / rate limits         |
                                     BullMQ queues        openai-compatible /
                                           |              ollama / openai /
                                     Worker pods          anthropic / disabled
                                                                |
                                                  Existing GPU inference runtime
                                                  (outside Kubernetes)

GitHub -> Actions (lint, test, build, scan) -> GHCR (images by digest)
       -> GitOps values update -> Argo CD (private, over Tailscale) -> K3s
```

## Key Decisions

| Decision                                           | Status                              | Rationale                                                                                                                                                                |
| -------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Modular monolith (NestJS) instead of microservices | Confirmed                           | One deployable API keeps operations proportionate to traffic. Modules own their controllers, services, DTOs, and tables, and do not reach into each other's persistence. |
| Separate worker process (BullMQ)                   | Confirmed (scaffold)                | Long or retryable work stays off the request path, and workers scale independently.                                                                                      |
| Static frontend (`output: 'export'`)               | Confirmed                           | No Node.js server to run, and it is served entirely from the CDN. The site stays up when the home server is offline.                                                     |
| Shared TypeScript contracts package                | Confirmed                           | Web and API compile against the same response types.                                                                                                                     |
| Project registry as a package                      | Confirmed                           | One source of truth for static routes, API data, and (later) chatbot grounding and navigation validation.                                                                |
| Portfolio-owned PostgreSQL and Redis               | Proposed                            | The reference host's existing databases publish no ports and serve other workloads. Reusing them would mean changing live services.                                      |
| AI behind a provider port; disabled by default     | Confirmed (port + disabled adapter) | Contributors need no model; deployers choose a provider through configuration only.                                                                                      |
| Inference runtime stays outside Kubernetes         | Proposed                            | The GPU runtime already serves another private workload, and moving it brings no measured benefit.                                                                       |
| K3s + Helm + Argo CD for the reference deployment  | Proposed                            | Demonstrates GitOps and autoscaling. Docker Compose remains the supported path for everyone else.                                                                        |
| pnpm workspaces, no Turborepo yet                  | Confirmed                           | Build graph is small; add Turborepo only when build times justify it.                                                                                                    |

## Repository Layout

```text
apps/web                 Next.js static site
apps/api                 NestJS REST API (/api/v1)
apps/worker              BullMQ worker (Nest standalone context)
packages/shared-types    API contracts
packages/project-registry  Typed, validated project data
packages/ui              Shared React components
packages/config          Shared TypeScript / lint presets
infrastructure/docker    Container images
infrastructure/helm      Helm charts (Phase 3)
infrastructure/argocd    Argo CD applications (Phase 3)
docs/                    Architecture, deployment, operations
```

## Availability Model

- The static site and project pages never depend on the API.
- Interactive mini-apps and the Infrastructure Explorer show an explicit "unavailable" state when
  the API cannot be reached. They never fall back to "healthy" or "crashed".
- The reference deployment is a single node. Kubernetes replicas improve rollout safety and
  process-level resilience, not physical availability.

## Related Documents

[Networking](networking.md) · [Kubernetes](kubernetes.md) · [AI integration](ai-integration.md) ·
[Security](security.md) · [Validation register](validation-register.md) ·
[Roadmap](../implementation-roadmap.md)
