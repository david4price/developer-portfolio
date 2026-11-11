---
paths:
  - 'docs/**'
  - 'README.md'
---

# Documentation Rules

- Label architecture statements **Confirmed** (implemented or verified), **Proposed**, or
  **Unknown**. Don't upgrade a label without evidence.
- Describe the reference deployment with placeholders. Real addresses, hostnames, container names,
  and hardware identifiers belong only in the private register outside this repo.
- Keep `docs/implementation-roadmap.md` in sync: mark backlog items done in the same change that
  completes them, and add new items with dependencies, acceptance criteria, and approval flags.
- Commands in docs must match the scripts in `package.json`; run them before documenting them.
- Record significant decisions as short ADRs under `docs/architecture/` (context, decision,
  consequences).
