---
paths:
  - 'apps/web/**'
  - 'packages/ui/**'
---

# Web Rules

- The site is a **static export** (`output: 'export'`). Do not use features that need a server:
  route handlers, server actions, middleware, `cookies()`/`headers()`, ISR/revalidate, or image
  optimization. Dynamic routes use `generateStaticParams()` from `@portfolio/project-registry`
  and `export const dynamicParams = false`.
- Content comes from `@portfolio/project-registry` (projects, mini-apps, and `profile`). Don't
  hard-code project data in pages.
- The API is optional at runtime. Every API-backed component must render distinct
  "not configured", "unavailable", and loaded states; use `apiUrl()` from `src/lib/api.ts`,
  a timeout, and `credentials: 'omit'` unless a cookie-based flow requires otherwise.
- Never render API or model output with `dangerouslySetInnerHTML`.
- Mini-apps load with `next/dynamic` on their own `/apps/[slug]` route so their code doesn't ship
  elsewhere. The portfolio assistant is a user-requested exception: a small launcher in the
  shared layout opens a site-wide popup and lazy-loads the chat client on first activation.
- Accessibility: semantic landmarks and headings, labelled controls, visible focus, status
  conveyed by text not color alone. Internal links use trailing slashes (`/projects/`).
- Styling uses the CSS custom properties in `globals.css`; support light and dark schemes.
- `packages/ui` is presentational only: no data fetching, no Next.js imports.
- Only `NEXT_PUBLIC_*` variables reach the browser; never put secrets in them.
