---
paths:
  - 'packages/**'
---

# Shared Package Rules

- `shared-types`: HTTP contracts only (types and a few constants). No runtime logic, no database
  row types. Changing a contract means updating the API and web consumers in the same change.
- `project-registry`: the single source of truth for projects and mini-apps. Every rule about valid
  content belongs in its zod schema and has a test. Use the `add-project` skill for content.
- `config`: framework-free environment helpers. No NestJS imports, no secret defaults, and errors
  name variables without echoing values.
- `ui`: presentational React components only.
- Libraries never import from `apps/*`.
- Packages build with `tsc -b` (composite) to `dist/`, expose it through `exports`, and list it in
  `files`; `pnpm deploy` relies on that.
- Reference new package dependencies in the consumer's `tsconfig.json` `references` and the root
  `tsconfig.json`.
