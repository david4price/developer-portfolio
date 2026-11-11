---
paths:
  - 'apps/api/**'
  - 'apps/worker/**'
---

# API and Worker Rules

- NestJS 12 on Fastify. `main.ts` only bootstraps; HTTP behavior shared with tests lives in
  `configureApp()` (`apps/api/src/app.setup.ts`). Tests must go through it.
- Depend on ports, not implementations: an interface plus a `Symbol` injection token, wired with a
  factory provider (see `projects.repository.ts`, `ai-provider.ts`). Adapters for PostgreSQL,
  Redis, BullMQ, and AI providers stay behind those tokens.
- Keep DI-injected classes as value imports; `consistent-type-imports` is disabled here on purpose.
- Configuration is parsed once by `loadApiConfig()` / `loadWorkerConfig()` using
  `@portfolio/config` helpers. New variables: add to the schema, `.env.example`, and
  `docs/deployment/local.md`. Never give secrets a default; never echo values in errors.
- Validate every input (params, query, body, queue payloads) with zod. Controllers use
  `ZodValidationPipe`; jobs parse `job.data` before use.
- Errors: throw `ApiException(status, code, message)`. Add new codes to `ApiErrorCode` in
  `@portfolio/shared-types`. Never return stack traces, SQL, or upstream messages to clients.
- Routes live under `/api/v1` (global prefix). No admin, debug, or proxy endpoints.
- Liveness (`/health`) never touches dependencies. A new required dependency exports a
  `ReadinessCheck` token and is added to `HealthModule.forChecks([...])`.
- Migrations run only via `pnpm db:migrate`, never at startup. Use the `db-migration` skill.
- Logs are JSON through Nest's `ConsoleLogger`; log objects with `requestId`, never request bodies,
  secrets, or personal data.
- Unit tests: `node:test`, `createTestApp()` from `test/support/test-app.ts`, in-memory fakes
  behind the same tokens. Integration tests go in `test/integration/` and skip without
  `DATABASE_URL`/`REDIS_URL`.
