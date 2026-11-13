# Infrastructure Explorer: Visual Design

**Status: Proposed (Phase 6, P6-04).** The data rules are in [Security](security.md#infrastructure-explorer-proposed-phase-6);
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

## Prototype

A clickable prototype with fake data can be built before the backend exists, to tune the look and
motion. It must use the same snapshot shape the API will return, so swapping in live data needs
no layout changes.
