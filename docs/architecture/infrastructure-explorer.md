# Infrastructure Explorer: Visual Design

**Status: prototype Confirmed on sample data (P6-04, 2026-11-18); live data Proposed (needs
P6-02).** The data rules are in [Security](security.md#infrastructure-explorer-proposed-phase-6);
this document covers what the page looks like and how data drives it.

## Concept

A live map of the whole deployment drawn as a **blueprint of a power grid**: a dark schematic sheet
with a fine grid, where each component is a **building seen from above** whose windows light up
when it runs, joined by power lines with **electric sparks** travelling along them. A title block
in the corner, as on an engineering drawing, gives the release as the drawing's revision. (The
first draft, a neon "temporal engine" look, read as generic and was replaced on 2026-11-18.)

## Layout

- **Buildings** on the grid: `web` (Cloudflare Pages), Cloudflare tunnel, `api`, `worker`,
  PostgreSQL, Redis, Argo CD, and the inference runtime as an opaque "AI model" building. Labels
  sit on plates in the paper's colour, so wires pass under them as on a schematic.
- **Delivery path** drawn as its own line: GitHub Actions → GHCR → `images.yaml` pin → Argo CD →
  cluster.
- **The cluster's flux capacitor** where the three flows meet (build from the registry, deploy from
  Argo CD, runtime down to the workloads): a grey box with a gasketed window and three glass tubes
  in a Y, an homage to the device in _Back to the Future_. It is drawn from scratch in SVG; its
  label tapes carry our own text ("K3s cluster" and the cluster's state), not the film's labels,
  name, or artwork.

## Data Mapping

Every effect means something; nothing animates without a data source.

| Visual                        | Driven by                                                         |
| ----------------------------- | ----------------------------------------------------------------- |
| Lit windows                   | Ready replicas: all lit, a share, or dark when down               |
| Flickering windows            | Component degraded                                                |
| Windows blinking awake        | Replicas still coming up during a rollout                         |
| Red roof beacon               | Component down                                                    |
| Line colour (cyan/amber/red)  | Health of the building at each end; broken line when down         |
| Spark speed along a line      | Coarse request rate (bucketed, e.g. idle/low/busy)                |
| Burst along the delivery path | A new release pinned in `images.yaml`, then the Argo CD sync      |
| Capacitor tubes glow          | Cluster deployed (Argo CD synced, nothing rolling out)            |
| Pulses into the capacitor's Y | Rollout in progress (a component progressing)                     |
| Capacitor dim / dark          | Waiting to sync (out of sync or unknown) / no data                |
| Labels and title block        | Status text, ready/desired counts, release, age (ticks every 1 s) |
| Whole grid dark               | Snapshot unavailable or stale: label says **"unavailable"**       |

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
- Window rule (`windowStates`): each building has 24 windows, lit in a fixed scattered order; the
  lit share is ready ÷ desired replicas (all for components without replicas), 60 % of that with
  some flickering when degraded, and none when down, unknown, or without data. During a rollout
  the windows still to light blink.
- Styling uses classes only (the site CSP blocks inline styles), on a blueprint sheet that looks
  the same in both themes. Reduced motion removes sparks, bursts, and all flicker; animations
  pause in hidden tabs; a table lists the same data as text.
- **Cards:** every building, delivery stage, and the flux capacitor is a button (Tab, Enter, or
  a click; rows in the text table have a "Details" button too). It opens a card in a modal
  `<dialog>` that shows the piece close up, then flips to its details: what it is (short copy in
  `card-content.ts`), its live facts (only the allowlisted snapshot fields: status, version,
  replicas, traffic, age; release and sync for the cluster and the pin), and a link to the
  architecture note it belongs to on GitHub, from the same notes the chat uses. Only the visible
  face is interactive (`inert`); Esc, a click outside, or Close shuts it and returns focus; reduced
  motion swaps the flip and pop for an instant change.
- Next: P6-02 serves the real snapshot. The page then fetches it every 12 s with the "not
  configured", "unavailable", and loaded states the web rules require.
