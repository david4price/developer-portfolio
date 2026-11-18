# Infrastructure Explorer: Visual Design

**Status: prototype Confirmed on sample data (P6-04, 2026-11-18); live data Proposed (needs
P6-02).** The data rules are in [Security](security.md#infrastructure-explorer-proposed-phase-6);
this document covers what the page looks like and how data drives it.

## Concept

A live map of the whole deployment, laid out as a grid of nodes joined by glowing conduits, in a
retro "temporal engine" style **inspired by** the flux capacitor from _Back to the Future_: a
Y-shaped core, neon tubes, and energy pulses running along the connections. It is an original
design that nods to the reference; it does not reproduce the film prop or its artwork.

## Layout

- **Nodes** (cards on a grid): `web` (Cloudflare Pages), Cloudflare tunnel, `api`, `worker`,
  PostgreSQL, Redis, Argo CD, and the inference runtime as an opaque "AI" node.
- **Delivery path** drawn as its own conduit: GitHub Actions → GHCR → `images.yaml` pin → Argo CD →
  cluster.
- **Core:** a Y-shaped junction where the three flows meet (build, deploy, runtime). It flickers
  while a rollout is in progress.

## Data Mapping

Every effect means something; nothing animates without a data source.

| Visual                           | Driven by                                                    |
| -------------------------------- | ------------------------------------------------------------ |
| Line colour (green/amber/red)    | Health of the node at each end                               |
| Pulse speed along a line         | Coarse request rate (bucketed, e.g. idle/low/busy)           |
| Burst along the delivery path    | A new release pinned in `images.yaml`, then the Argo CD sync |
| Core flicker                     | Rollout in progress (desired ≠ ready)                        |
| Node badge                       | Image version (tag only), ready/desired counts, last updated |
| Whole map dark, core powered off | Snapshot unavailable or stale: label says **"unavailable"**  |

The page must never show "healthy" when it cannot know: offline or stale data powers the map
down instead of freezing the last good state.

Two inputs go beyond the current serializer allowlist and must be added there (and to its
snapshot tests) before they are shown: a **bucketed request rate** per Service (from P7-01
metrics, never raw counts per client) and the **latest release** (short commit SHA and time from
the `images.yaml` pin or the public GitHub Actions API).

## Implementation Notes

- A client component inside the static page. It fetches the sanitized snapshot from the API
  every 10–15 s (matching the server cache) and renders nothing from the cluster directly.
- SVG for nodes and conduits: glow via an SVG filter; pulses via animated `stroke-dashoffset` or
  small markers moving along each path. Canvas or WebGL only if the node count grows past what SVG
  handles smoothly (well beyond this deployment's few dozen elements).
- `prefers-reduced-motion`: a static map with the same colours and labels, no pulses or flicker.
- Accessible without the animation: each node has a text status, and a plain table view lists the
  same data.
- Animations pause when the tab is hidden.

## Prototype (Confirmed, sample data)

`/apps/infrastructure-explorer/` shows the map on sample data, labelled as a prototype, with five
scenarios to click through: steady, rollout in progress, Redis down, API offline, and stale data.
It uses the snapshot shape the API will return (`InfrastructureSnapshot` in
`@portfolio/shared-types`), so live data replaces `sample-snapshots.ts` without layout changes.

- Code: `apps/web/src/mini-apps/infrastructure-explorer/`. `map-model.ts` holds the rules as pure,
  tested functions; `explorer-map.tsx` draws the SVG; the page loads it with `next/dynamic` and
  `ssr: false` (it shows times relative to now).
- Rules as built: a snapshot older than 60 s, or none at all, powers the map down with
  "unavailable"; a component the snapshot omits is "unknown", never healthy; a conduit takes the
  worse health of its two ends; pulses run only where traffic data exists (none yet, until P7-01)
  and never into a down component; the core flickers only while a component is progressing, so a
  crash-looping component shows as down, not as a rollout; the delivery path bursts for 15 minutes
  after a release is pinned.
- Styling uses classes only (the site CSP blocks inline styles), on a dark panel in both themes.
  Reduced motion removes pulses, bursts, and flicker; animations pause in hidden tabs; a table
  lists the same data as text.
- Next: P6-02 serves the real snapshot. The page then fetches it every 12 s with the "not
  configured", "unavailable", and loaded states the web rules require.
