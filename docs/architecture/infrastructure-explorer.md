# Infrastructure Explorer: Visual Design

**Status: prototype Confirmed on sample data (P6-04, 2026-11-18); workload API live (P6-01/02),
Argo CD reader implemented/live-tested (P6-03, production activation pending); live page Proposed.**
The data rules are in [Security](security.md#infrastructure-explorer-serializer-confirmed-in-code-p6-02-access-confirmed-in-the-chart-p6-01);
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
| Burst along the delivery path | A GitOps revision successfully deployed by Argo CD                |
| Capacitor tubes glow          | Cluster deployed (Argo CD synced, nothing rolling out)            |
| Pulses into the capacitor's Y | Rollout in progress (a component progressing)                     |
| Capacitor dim / dark          | Waiting to sync (out of sync or unknown) / no data                |
| Labels and title block        | Status text, ready/desired counts, release, age (ticks every 1 s) |
| Whole grid dark               | Snapshot unavailable or stale: label says **"unavailable"**       |

The page must never show "healthy" when it cannot know: offline or stale data powers the map
down instead of freezing the last good state.

The release input is the short last-deployed GitOps revision and deployment time from Argo CD
history (P6-03); it is neither the API source commit nor the image pin time. A **bucketed request
rate** per Service still needs P7-01 metrics and allowlist/leak tests before it can be shown.

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

## Live view and simulation (Confirmed in code, P6-04)

`/apps/infrastructure-explorer/` opens on **live data**: `GET /api/v1/infrastructure`, fetched
every 12 s (with an 8 s timeout, no cookies, no cache, and nothing while the tab is hidden). A
**Live data** switch turns it off for the **simulation**, which offers five scenarios to click
through: steady, rollout in progress, Redis down, API offline, and stale data. A build without an
API address (`NEXT_PUBLIC_API_BASE_URL` unset, as in local static builds and Pages previews) shows
the switch disabled and opens on the simulation.

- Live states: "connecting" before the first answer (and after returning to a tab whose data
  fell due, so a fresh view never flashes stale); the last good snapshot, kept through failed
  refreshes until no new snapshot has arrived for 60 s (then "too old to trust"); "not enabled
  here" as soon as the API answers `infrastructure_disabled`; "unavailable" when no snapshot has
  arrived. All but the fresh snapshot power the map down rather than show "healthy".
- Staleness is judged on the visitor's clock alone: a snapshot is fresh while new ones (a new
  `generatedAt`) keep arriving, so a visitor whose clock is off from the server's still sees the
  live map, and a server stuck on one snapshot still powers it down after 60 s. Nothing is
  requested from a hidden tab, including on first load.
- `live-snapshot.ts` checks every field of the response (known component ids, health, failure,
  traffic, and sync values; bounded strings and counts; no duplicates) and treats anything else as
  unavailable.
- The website building is filled in on the visitor's side: the cluster can't see Cloudflare
  Pages, so the API reports it as unknown, but the page loading proves it is served.
- Both views use the same snapshot shape (`InfrastructureSnapshot` in `@portfolio/shared-types`),
  so the map, table, and cards don't know which one they draw.

- Code: `apps/web/src/mini-apps/infrastructure-explorer/`. `map-model.ts` holds the rules as pure,
  tested functions; `explorer-map.tsx` draws the SVG; the page loads it with `next/dynamic` and
  `ssr: false` (it shows times relative to now).
- Rules as built: a snapshot older than 60 s, or none at all, powers the map down with
  "unavailable"; a component the snapshot omits is "unknown", never healthy; a conduit takes the
  worse health of its two ends; pulses run only where traffic data exists (none yet, until P7-01)
  and never into a down component; the core flickers only while a component is progressing, so a
  crash-looping component shows as down, not as a rollout; the delivery path bursts for 15 minutes
  after a GitOps revision is deployed.
- Window rule (`windowStates`): each building has 24 windows, lit in a fixed scattered order; the
  lit share is ready ÷ desired replicas (all for components without replicas), 60 % of that with
  some flickering when degraded, and none when down, unknown, or without data. During a rollout
  the windows still to light blink.
- Styling uses classes only (the site CSP blocks inline styles), on a blueprint sheet that looks
  the same in both themes. Reduced motion removes sparks, bursts, and all flicker; animations
  pause in hidden tabs; a table lists the same data as text.
- **Layouts:** a landscape drawing (920 × 710) for wider screens and a portrait one (450 × 1250,
  labels 1.2× larger) for phones (≤ 640 px), chosen by a media query and switched on resize. Each
  layout (`WIDE_LAYOUT`, `NARROW_LAYOUT` in `map-model.ts`) places every building and routes every
  wire explicitly; tests check, for both, that no two wires share a stretch and that each route
  runs from inside its source building to inside its target. The landscape map scrolls inside its
  frame if the screen is a little too narrow; the page itself never scrolls sideways.
- Staleness is judged from when the snapshot arrived (it goes stale once refreshes stop for
  60 s), and from how old it already was on arrival, so a visitor's slow clock doesn't power the
  map down.
- **Cards:** every building, delivery stage, and the flux capacitor is a button (Tab, Enter, or
  a click; rows in the text table have a "Details" button too). It opens a card in a modal
  `<dialog>` that shows the piece close up, then flips to its details: what it is (short copy in
  `card-content.ts`), its live facts (only the allowlisted snapshot fields: status, version,
  replicas, traffic, age; release and sync for the cluster and the pin), and a link to the
  architecture note it belongs to on GitHub, from the same notes the chat uses. Only the visible
  face is interactive (`inert`); Esc, a click outside, or Close shuts it and returns focus; reduced
  motion swaps the flip and pop for an instant change.
- The API side exists (P6-02): `GET /api/v1/infrastructure` returns this snapshot from the
  allowlist serializer, cached for 12 s, and is off until `INFRASTRUCTURE_SOURCE=kubernetes`. From
  the cluster it fills health, replicas, image version, and failure for the tunnel, API, worker,
  PostgreSQL, and Redis; the website and AI model stay "unknown".
- P6-03 adds an optional Argo CD reader (implemented; token and adapter live-tested, production
  activation pending this change's rollout): `sync` comes from the Application; `release` is its
  last successfully deployed GitOps revision and deployment time, not the API's source commit
  or image pin time. The Argo CD component is healthy when its API is reachable, unknown when
  unavailable. Deployment facts become unknown if its read fails; workload facts can stay fresh.
  Traffic still waits for metrics (P7-01).
- Next: P6-01 is live; publish/merge the P6-03 integration, then the page fetches every 12 s
  with the "not configured", "unavailable", and loaded states the web rules require.
