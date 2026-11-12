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
- `docs/implementation-roadmap.md` is the project checklist. In the same change that completes a
  task, tick its box, update the phase count, and refresh **Resume Here** (date, recently done,
  next up, waiting on the owner). New tasks get a stable ID, `_Needs:_`, `_Done when:_`, and 🔒
  when they touch a running server or external account.
- Commands in docs must match the scripts in `package.json`; run them before documenting them.
- Record significant decisions as short ADRs under `docs/architecture/` (context, decision,
  consequences).
