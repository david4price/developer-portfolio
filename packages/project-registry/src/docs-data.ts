import type { DocNotesInput } from './schema.js';

/**
 * Short notes on how this site works, curated from `docs/architecture/` and the deployment guides,
 * for the chat assistant. Keep each one self-contained, current, and high level: no screening
 * internals, hostnames, addresses, or other private details. `source` is the doc or folder a
 * visitor opens to read more; a test checks that it exists.
 */
export const docNotesData: DocNotesInput = {
  repositoryUrl: 'https://github.com/david4price/developer-portfolio',
  branch: 'main',
  notes: [
    {
      slug: 'architecture-overview',
      title: 'How the site is built',
      keywords: ['architecture', 'stack', 'design', 'structure', 'monorepo', 'overview'],
      text:
        'A pnpm monorepo in TypeScript: a statically exported Next.js site, a NestJS REST API ' +
        '(one modular monolith under /api/v1), a BullMQ worker, and shared packages for HTTP ' +
        'contracts and content. PostgreSQL stores data; Redis holds sessions, limits, and queues. ' +
        'The site never depends on the API, so it stays up when the server is offline.',
      source: 'docs/architecture/overview.md',
    },
    {
      slug: 'static-site',
      title: 'The static site on Cloudflare Pages',
      keywords: [
        'frontend',
        'website',
        'hosting',
        'hosted',
        'pages',
        'cdn',
        'react',
        'csp',
        'headers',
        'preview',
      ],
      text:
        'The Next.js site is exported to plain files and served by Cloudflare Pages, with no ' +
        'server of its own. Cloudflare builds every push to main and a preview for every pull ' +
        'request, so no deploy token lives in the repository or CI. Each build writes a strict ' +
        'Content Security Policy with hashes of its inline scripts, plus other security headers.',
      source: 'docs/deployment/cloudflare-pages.md',
    },
    {
      slug: 'rest-api',
      title: 'The REST API',
      keywords: ['backend', 'nestjs', 'fastify', 'endpoints', 'validation', 'zod', 'ports'],
      text:
        'A NestJS API on Fastify, built as one modular monolith: each module owns its routes and ' +
        'data and never reads another module’s tables. Inputs are validated with zod, errors are ' +
        'typed and never expose internals, and routes are versioned under /api/v1. Databases, ' +
        'queues, and AI providers sit behind interfaces (ports), so each can be swapped or faked ' +
        'in tests.',
      source: 'apps/api/src/',
    },
    {
      slug: 'kubernetes',
      title: 'Running on Kubernetes',
      keywords: ['k3s', 'helm', 'cluster', 'pods', 'autoscaling', 'hpa', 'networkpolicy'],
      text:
        'Production runs on single-node K3s on a home server, from a Helm chart in this ' +
        'repository. The API scales between 1 and 3 pods on CPU load; the worker, PostgreSQL, ' +
        'and Redis run beside it. Every pod runs as non-root with a read-only filesystem and no ' +
        'extra privileges, and network policies deny all traffic except the paths each part ' +
        'needs.',
      source: 'docs/architecture/kubernetes.md',
    },
    {
      slug: 'gitops-release',
      title: 'Releases and GitOps',
      keywords: [
        'deploy',
        'deployed',
        'deployment',
        'ci',
        'cd',
        'argo',
        'pipeline',
        'github',
        'actions',
        'push',
        'pushed',
      ],
      text:
        'GitHub Actions lints, tests, and builds every change. After a merge to main that can ' +
        'change an image (not docs alone), a release workflow pushes the API and worker images ' +
        'to GitHub Container Registry and commits their digests to the production values. Argo CD, which is not public, syncs the cluster ' +
        'from Git with rolling updates gated by readiness checks. Rolling back means reverting ' +
        'that commit.',
      source: 'docs/architecture/kubernetes.md',
    },
    {
      slug: 'networking',
      title: 'How traffic reaches the API',
      keywords: ['network', 'tunnel', 'cloudflared', 'cloudflare', 'ports', 'firewall', 'access'],
      text:
        'The API is reached through a Cloudflare Tunnel: a pod inside the cluster connects out ' +
        'to Cloudflare, so the home router opens no inbound ports. Only /api/v1 is routed; any ' +
        'other path is a 404. Admin tools such as Argo CD and the Kubernetes API are never ' +
        'public and are reached only over a private network.',
      source: 'docs/architecture/networking.md',
    },
    {
      slug: 'secrets',
      title: 'How secrets are managed',
      keywords: ['sealed', 'encryption', 'passwords', 'credentials', 'keys', 'adr'],
      text:
        'Secrets are committed to Git only in encrypted form, as Sealed Secrets that just the ' +
        'cluster can decrypt. The Helm chart never contains a secret, and nothing secret is ' +
        'in the public repository. The cluster can be rebuilt from Git plus one backed-up key, ' +
        'and that restore has been tested.',
      source: 'docs/architecture/adr-0001-secrets-management.md',
    },
    {
      slug: 'chat-assistant',
      title: 'How the chat assistant works',
      keywords: ['ai', 'chatbot', 'llm', 'model', 'gpu', 'retrieval', 'turnstile', 'limits'],
      text:
        'A small open-weight model runs on the home server’s GPU; the API calls it through a ' +
        'provider interface. AI is off by default, so the project runs without any model. ' +
        'Answers come from the project registry and curated architecture notes, found by ' +
        'keyword search. A bot ' +
        'check, quotas, a queue, and message screening protect it, and it links only to pages ' +
        'that exist.',
      source: 'docs/architecture/ai-integration.md',
    },
    {
      slug: 'offline-behaviour',
      title: 'What happens when the server is offline',
      keywords: ['availability', 'outage', 'downtime', 'resilience', 'unavailable', 'failure'],
      text:
        'The site is served from Cloudflare’s network, so it keeps working when the home server ' +
        'is down. Parts that need the API, like the chat, say plainly that it is unavailable ' +
        'instead of failing silently. This was tested with the whole cluster stopped: the site ' +
        'stayed up, and everything recovered on its own with data intact.',
      source: 'docs/operations/runbooks.md',
    },
    {
      slug: 'backups',
      title: 'Database backups',
      keywords: [
        'backup',
        'restore',
        'postgresql',
        'database',
        'recovery',
        'cronjob',
        'loss',
        'lost',
        'lose',
      ],
      text:
        'A Kubernetes CronJob dumps PostgreSQL every night, checks each dump before keeping it, ' +
        'and keeps 7 daily and 4 weekly copies. A restore was drilled: the dump restored ' +
        'cleanly and every table’s row count matched production.',
      source: 'docs/operations/runbooks.md',
    },
    {
      slug: 'local-development',
      title: 'Running the project yourself',
      keywords: [
        'setup',
        'install',
        'installed',
        'installation',
        'docker',
        'compose',
        'clone',
        'run',
        'locally',
        'contribute',
      ],
      text:
        'Anyone can clone the repository and run it with Node.js, pnpm, and Docker Compose, ' +
        'which starts PostgreSQL and Redis or the whole stack. It needs none of the author’s ' +
        'infrastructure: AI is disabled by default, and every setting comes from documented ' +
        'environment variables.',
      source: 'docs/deployment/local.md',
    },
    {
      slug: 'testing',
      title: 'Testing and quality checks',
      keywords: [
        'tests',
        'tested',
        'testing',
        'ci',
        'lint',
        'typecheck',
        'quality',
        'integration',
        'scan',
      ],
      text:
        'Every pull request runs formatting, lint, type checks, and unit tests, then integration tests ' +
        'against real PostgreSQL and Redis, Helm chart validation, a secret scan, and container ' +
        'builds. Unit tests use Node’s built-in test runner and cover failure paths as well as ' +
        'the happy path.',
      source: '.github/workflows/ci.yml',
    },
  ],
};
