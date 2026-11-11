---
name: api-module
description: Add or extend a NestJS module in apps/api following this repository's ports-and-adapters pattern — injection tokens, factory providers, zod-validated inputs, typed ApiException errors, shared HTTP contracts, readiness checks, and node:test coverage through createTestApp. Use when adding endpoints, modules, or external integrations to the API or worker.
---

# Add an API Module

Reference implementation: `apps/api/src/modules/projects/`. Read it before starting.

## 1. Design the Boundary

- **Contract:** define request/response types in `packages/shared-types/src/index.ts`. Add any new
  error codes to `ApiErrorCode`.
- **Port:** an interface plus a `Symbol` token in `<module>/<name>.repository.ts` (or `.port.ts`).
  Controllers and services depend only on the port.
- **Adapter:** the PostgreSQL/Redis/HTTP implementation in its own file, constructed by a
  `useFactory` provider that injects infrastructure tokens (`DATABASE`, `REDIS`, `API_CONFIG`).
- A module never imports another module's adapter or tables. Share through an exported port.

## 2. Implement

```text
apps/api/src/modules/<name>/
  <name>.module.ts         providers: token → factory(adapter)
  <name>.controller.ts     thin: validate, call port/service, map to contract
  <name>.repository.ts     port + token
  <adapter>.<name>.repository.ts
```

- Route paths are relative to the global `/api/v1` prefix.
- Validate every param/query/body with `new ZodValidationPipe(schema)`; reuse schemas from
  `@portfolio/project-registry` or `@portfolio/config` where they exist.
- Throw `ApiException(HttpStatus.X, 'code', 'Client-safe message')`. Unexpected errors fall through
  to `ApiExceptionFilter`, which logs them and returns a generic 500.
- New configuration goes through `loadApiConfig()` (schema, `.env.example`, local docs). No secret
  defaults.
- New required infrastructure exports a `ReadinessCheck` under its own token and is added to
  `HealthModule.forChecks([...])` in `app.module.ts`. Optional dependencies must not affect
  readiness.
- Register the module in `AppModule.register()`.
- Public, expensive, or abusable endpoints need rate limits, size limits, and timeouts (see the
  `application-security` skill) before they ship.

## 3. Test

In `apps/api/test/<name>.test.ts`, with `node:test`:

- Build the app with `createTestApp({ controllers, providers })` and bind the port token to an
  in-memory fake.
- Use `app.inject()` to cover success, 400 for invalid input, 404/typed errors with `requestId`,
  and any rate-limit or overload responses.
- Adapter behavior against real PostgreSQL/Redis goes in `test/integration/` (skipped without
  `DATABASE_URL`/`REDIS_URL`).

Worker jobs follow the same idea: a pure, zod-validated processor function (tested directly) plus a
thin BullMQ wiring in a service.

## 4. Finish

Update `docs/` if endpoints, configuration, or behavior changed, mark roadmap items, and run the
`verify` skill.
