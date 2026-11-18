import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { InfrastructureComponent, InfrastructureSnapshot } from '@portfolio/shared-types';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CARD_IDS, cardDetails } from '../src/mini-apps/infrastructure-explorer/card-content.js';
import { ExplorerCard } from '../src/mini-apps/infrastructure-explorer/explorer-card.js';
import { ExplorerMap } from '../src/mini-apps/infrastructure-explorer/explorer-map.js';
import {
  ExplorerTable,
  InfrastructureExplorer,
  livePower,
} from '../src/mini-apps/infrastructure-explorer/infrastructure-explorer.js';
import {
  fetchLiveSnapshot,
  parseSnapshot,
  withVisitorWebsite,
} from '../src/mini-apps/infrastructure-explorer/live-snapshot.js';
import {
  componentById,
  componentStatus,
  conduitTraffic,
  coreState,
  formatAge,
  layoutWires,
  type MapLayout,
  NARROW_LAYOUT,
  OFF_REASONS,
  type Point,
  RUNTIME_CONDUITS,
  WIDE_LAYOUT,
  MAP_NODES,
  mapPower,
  recentRelease,
  rolloutInProgress,
  STALE_AFTER_MS,
  type WindowState,
  windowStates,
  worseHealth,
} from '../src/mini-apps/infrastructure-explorer/map-model.js';
import {
  SAMPLE_SCENARIOS,
  sampleSnapshot,
} from '../src/mini-apps/infrastructure-explorer/sample-snapshots.js';

const NOW = Date.parse('2026-11-18T12:00:00Z');

const component = (overrides: Partial<InfrastructureComponent>): InfrastructureComponent => ({
  id: 'api',
  health: 'healthy',
  version: 'a1b2c3d',
  replicas: { desired: 1, available: 1, ready: 1 },
  traffic: 'low',
  failure: null,
  ...overrides,
});

const snapshotWith = (
  components: readonly InfrastructureComponent[],
  overrides: Partial<InfrastructureSnapshot> = {},
): InfrastructureSnapshot => ({
  generatedAt: new Date(NOW - 5_000).toISOString(),
  sync: 'synced',
  release: null,
  components,
  ...overrides,
});

const steady = () => {
  const snapshot = sampleSnapshot('steady', NOW);
  assert.ok(snapshot);
  return snapshot;
};

describe('mapPower', () => {
  it('powers the map off without a snapshot, or with a stale or unreadable one', () => {
    assert.deepEqual(mapPower(null, NOW), { on: false, reason: 'unavailable' });
    const old = snapshotWith([], {
      generatedAt: new Date(NOW - STALE_AFTER_MS - 1).toISOString(),
    });
    assert.deepEqual(mapPower(old, NOW), { on: false, reason: 'stale' });
    const fresh = snapshotWith([]);
    assert.deepEqual(
      mapPower(fresh, NOW, NOW - STALE_AFTER_MS - 1),
      { on: false, reason: 'stale' },
      'received too long ago: refreshes stopped',
    );
    const ahead = snapshotWith([], { generatedAt: new Date(NOW + 5 * 60_000).toISOString() });
    assert.equal(mapPower(ahead, NOW).on, true, 'a visitor clock behind the server is no problem');
    assert.deepEqual(mapPower(snapshotWith([], { generatedAt: 'not a time' }), NOW), {
      on: false,
      reason: 'stale',
    });
  });

  it('shows a fresh snapshot', () => {
    const fresh = steady();
    assert.deepEqual(mapPower(fresh, NOW), { on: true, snapshot: fresh });
  });
});

describe('map model', () => {
  it('colours a conduit by the worse of its two ends', () => {
    assert.equal(worseHealth('healthy', 'down'), 'down');
    assert.equal(worseHealth('degraded', 'progressing'), 'degraded');
    assert.equal(worseHealth('healthy', 'unknown'), 'unknown');
    assert.equal(worseHealth('healthy', 'healthy'), 'healthy');
  });

  it('treats a component missing from the snapshot as unknown, never healthy', () => {
    const missing = componentById(snapshotWith([]), 'redis');
    assert.equal(missing.health, 'unknown');
    assert.equal(componentStatus(missing), 'Unknown');
  });

  it('flags a rollout only while a component is progressing, not when one is failing', () => {
    assert.equal(rolloutInProgress(steady()), false);
    assert.equal(rolloutInProgress(snapshotWith([component({ health: 'progressing' })])), true);
    const failing = component({
      health: 'down',
      replicas: { desired: 1, available: 0, ready: 0 },
      failure: 'crash-loop',
    });
    assert.equal(rolloutInProgress(snapshotWith([failing])), false);
  });

  it('glows the cluster core when deployed, pulses it in a rollout, dims it while unsynced', () => {
    assert.equal(coreState(null), 'off');
    assert.equal(coreState(steady()), 'deployed');
    assert.equal(coreState(sampleSnapshot('rollout', NOW)), 'rollout');
    assert.equal(coreState(snapshotWith([component({})], { sync: 'out-of-sync' })), 'waiting');
    assert.equal(coreState(snapshotWith([component({})], { sync: 'unknown' })), 'waiting');
  });

  it('bursts the delivery path only for a release pinned in the last few minutes', () => {
    const pinned = (ago: number) =>
      snapshotWith([], {
        release: { commit: 'a1b2c3d', pinnedAt: new Date(NOW - ago).toISOString() },
      });
    assert.equal(recentRelease(pinned(60_000), NOW), true);
    assert.equal(recentRelease(pinned(60 * 60_000), NOW), false);
    assert.equal(recentRelease(snapshotWith([]), NOW), false);
  });

  it('pulses only with traffic data, at the busier end, and never into a down component', () => {
    assert.equal(
      conduitTraffic(component({ traffic: 'low' }), component({ traffic: 'busy' })),
      'busy',
    );
    assert.equal(conduitTraffic(component({ traffic: null }), component({ traffic: null })), null);
    assert.equal(
      conduitTraffic(component({ traffic: 'busy' }), component({ health: 'down', traffic: null })),
      null,
    );
  });

  it('lights a building by what runs inside: all, a ready share, flickering, or none', () => {
    const count = (states: readonly WindowState[], state: WindowState) =>
      states.filter((value) => value === state).length;
    const healthy = windowStates(component({}));
    assert.equal(healthy.length, 24);
    assert.equal(count(healthy, 'lit'), 24);

    const halfReady = { desired: 2, available: 1, ready: 1 };
    const rolling = windowStates(component({ health: 'progressing', replicas: halfReady }));
    assert.equal(count(rolling, 'lit'), 12);
    assert.equal(count(rolling, 'waking'), 12, 'the rest are waking up');

    const degraded = windowStates(component({ health: 'degraded' }));
    assert.ok(count(degraded, 'flicker') > 0);
    assert.ok(count(degraded, 'lit') + count(degraded, 'flicker') < 24);

    for (const dark of [
      windowStates(component({ health: 'down' })),
      windowStates(component({ health: 'unknown' })),
      windowStates(null),
    ]) {
      assert.equal(count(dark, 'dark'), 24);
    }
    assert.deepEqual(windowStates(component({})), healthy, 'the same data draws the same building');
  });

  it('formats ages the same way everywhere: seconds, minutes, hours', () => {
    const at = (ago: number) => new Date(NOW - ago).toISOString();
    assert.equal(formatAge(at(4_000), NOW), '4 s ago');
    assert.equal(formatAge(at(10 * 60_000), NOW), '10 min ago');
    assert.equal(formatAge(at(3 * 3_600_000), NOW), '3 h ago');
    assert.equal(formatAge('not a time', NOW), 'unknown');
  });

  it('describes status in text, not colour alone', () => {
    assert.equal(
      componentStatus(
        component({
          health: 'down',
          replicas: { desired: 1, available: 0, ready: 0 },
          failure: 'crash-loop',
        }),
      ),
      'Down, 0/1 ready, restarting repeatedly',
    );
  });
});

describe('sample snapshots', () => {
  it('use the API shape: every map component once, tag-only versions', () => {
    for (const scenario of SAMPLE_SCENARIOS) {
      const snapshot = sampleSnapshot(scenario, NOW);
      if (snapshot === null) continue;
      const ids = snapshot.components.map(({ id }) => id).sort();
      assert.deepEqual(ids, MAP_NODES.map(({ id }) => id).sort(), scenario);
      for (const { version } of snapshot.components) {
        assert.ok(version === null || /^[\w.-]+$/.test(version), `${scenario}: ${version}`);
      }
    }
  });

  it('cover every state the design calls for', () => {
    assert.equal(mapPower(sampleSnapshot('offline', NOW), NOW).on, false);
    assert.deepEqual(mapPower(sampleSnapshot('stale', NOW), NOW), { on: false, reason: 'stale' });
    const rollout = sampleSnapshot('rollout', NOW);
    assert.ok(rollout && rolloutInProgress(rollout) && recentRelease(rollout, NOW));
    const degraded = sampleSnapshot('degraded', NOW);
    assert.equal(degraded && componentById(degraded, 'redis').health, 'down');
  });
});

describe('ExplorerMap', () => {
  it('labels every component with a text status from the snapshot', () => {
    const html = renderToStaticMarkup(
      createElement(ExplorerMap, { power: mapPower(steady(), NOW), now: NOW }),
    );
    for (const { label } of MAP_NODES) assert.ok(html.includes(label), label);
    assert.match(html, /role="group"/);
    assert.ok(!html.includes('role="button"'), 'no controls without onSelect');
    assert.match(html, /8 of 8 components healthy/);
    assert.match(html, /Healthy, 1\/1 ready/);
    assert.ok(!html.includes('explorer-map--off'));
  });

  it('powers down and says unavailable, never healthy, without fresh data', () => {
    for (const power of [mapPower(null, NOW), mapPower(sampleSnapshot('stale', NOW), NOW)]) {
      const html = renderToStaticMarkup(createElement(ExplorerMap, { power, now: NOW }));
      assert.match(html, /explorer-map--off/);
      assert.match(html, /Unavailable/);
      assert.ok(!/healthy/i.test(html), 'no healthy label or class when powered off');
      assert.ok(!html.includes('explorer-conduit__pulse'), 'nothing animates without data');
    }
  });

  it('flickers the core during a rollout and pulses only where traffic is known', () => {
    const rollout = sampleSnapshot('rollout', NOW);
    const html = renderToStaticMarkup(
      createElement(ExplorerMap, { power: mapPower(rollout, NOW), now: NOW }),
    );
    assert.match(html, /explorer-core--rollout/);
    assert.match(html, /explorer-core__pulse/);
    assert.match(html, /Rolling out/);
    const deployed = renderToStaticMarkup(
      createElement(ExplorerMap, { power: mapPower(steady(), NOW), now: NOW }),
    );
    assert.match(deployed, /explorer-core--deployed/);
    assert.ok(!deployed.includes('explorer-core__pulse'), 'no pulses once deployed');
    assert.match(html, /explorer-conduit__burst/);
    assert.match(html, /explorer-conduit__pulse--busy/);
  });

  it('uses no inline style attributes, which the site CSP blocks', () => {
    for (const scenario of SAMPLE_SCENARIOS) {
      const html = renderToStaticMarkup(
        createElement(ExplorerMap, {
          power: mapPower(sampleSnapshot(scenario, NOW), NOW),
          now: NOW,
        }),
      );
      assert.ok(!/\sstyle=/.test(html), scenario);
    }
  });
});

describe('ExplorerTable', () => {
  it('lists the same data as text, or says the status is unavailable', () => {
    const html = renderToStaticMarkup(
      createElement(ExplorerTable, { power: mapPower(steady(), NOW), now: NOW }),
    );
    assert.match(html, /<table/);
    assert.match(html, /Updated 4 s ago/);
    assert.match(html, /GitOps: Synced/);
    for (const { label } of MAP_NODES) {
      assert.ok(html.includes(`<th scope="row" role="rowheader">${label}</th>`), label);
    }
    // Phones stack each row and label its values from data-label; roles keep it a table.
    assert.match(html, /role="table"/);
    assert.match(html, /<td role="cell" data-label="Status">/);

    const off = renderToStaticMarkup(
      createElement(ExplorerTable, { power: mapPower(null, NOW), now: NOW }),
    );
    assert.match(off, /role="status"/);
    assert.match(off, /Status unavailable/);
    assert.ok(!off.includes('<table'));
  });
});

describe('cards', () => {
  const power = () => mapPower(steady(), NOW);

  it('give every piece of the map copy and a link to an existing architecture note', () => {
    assert.equal(CARD_IDS.length, 12);
    for (const id of CARD_IDS) {
      const details = cardDetails(id, power(), NOW);
      assert.ok(details.about.length > 20, id);
      assert.ok(
        details.more?.url.startsWith('https://github.com/'),
        `${id} links to its note on GitHub`,
      );
    }
  });

  it('show live facts only from the snapshot, and say so when there are none', () => {
    const api = cardDetails('api', power(), NOW);
    assert.deepEqual(
      api.facts.map(([label]) => label),
      ['Status', 'Version', 'Replicas', 'Traffic', 'Updated'],
    );
    assert.ok(api.facts.some(([, value]) => value === '1 ready, 1 available, 1 desired'));
    assert.equal(api.noFacts, null);

    const cluster = cardDetails('cluster', power(), NOW);
    assert.ok(cluster.facts.some(([label, value]) => label === 'State' && value === 'Deployed'));
    const pin = cardDetails('pin', power(), NOW);
    assert.ok(pin.facts.some(([label, value]) => label === 'Release' && value === 'a1b2c3d'));
    assert.equal(cardDetails('actions', power(), NOW).noFacts, 'No live data for this stage yet.');

    const off = cardDetails('api', mapPower(null, NOW), NOW);
    assert.deepEqual(off.facts, []);
    assert.equal(off.noFacts, 'Live status unavailable.');
  });

  it('open from every building and the capacitor on the map, and from each table row', () => {
    const map = renderToStaticMarkup(
      createElement(ExplorerMap, { power: power(), now: NOW, onSelect() {} }),
    );
    assert.equal(map.match(/role="button"/g)?.length, 12);
    assert.match(map, /aria-label="API: Healthy, 1\/1 ready\. Open details\."/);
    assert.match(map, /aria-label="K3s cluster: Deployed\. Open details\."/);

    const table = renderToStaticMarkup(
      createElement(ExplorerTable, { power: power(), now: NOW, onSelect() {} }),
    );
    assert.equal(table.match(/class="explorer-table__details"/g)?.length, 8);
  });

  it('open on their details (focus never jumps), with the front inert, and link out safely', () => {
    const closed = renderToStaticMarkup(
      createElement(ExplorerCard, { id: null, power: power(), now: NOW, onClose() {} }),
    );
    assert.ok(!closed.includes('explorer-card__face'));

    const html = renderToStaticMarkup(
      createElement(ExplorerCard, { id: 'api', power: power(), now: NOW, onClose() {} }),
    );
    assert.match(html, /<dialog[^>]*aria-labelledby=/);
    assert.match(html, /explorer-card__flipper" data-flipped="true"/);
    assert.match(html, /explorer-card__face--front"[^>]*inert/);
    assert.ok(!/explorer-card__face--back"[^>]*inert/.test(html));
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /Read more: The REST API/);
    assert.ok(!/\sstyle=/.test(html), 'no inline styles (CSP)');
  });
});

describe('layouts', () => {
  type Segment = readonly [Point, Point];

  /** Every wire the map draws in a layout (the same list it draws), as straight segments. */
  function wires(layout: MapLayout): Map<string, Segment[]> {
    const segments = (points: readonly Point[]): Segment[] =>
      points.slice(1).map((point, index) => [points[index] as Point, point] as const);
    const drawn = layoutWires(layout);
    return new Map<string, Segment[]>([
      ...drawn.delivery.map((points, index) => [`delivery-${index}`, segments(points)] as const),
      ['build-arm', segments(drawn.buildArm)],
      ['deploy-arm', segments(drawn.deployArm)],
      ['core-hub', segments(drawn.coreHub)],
      ['hub-api', segments(drawn.hubApi)],
      ['hub-worker', segments(drawn.hubWorker)],
      ...RUNTIME_CONDUITS.map(({ key }) => [key, segments(drawn.runtime[key])] as const),
    ]);
  }

  /** Length two segments share when they lie on one line; 0 when they only cross or touch. */
  function sharedLength([a, b]: Segment, [c, d]: Segment): number {
    const cross = (p: Point, q: Point, r: Point) =>
      (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    if (Math.abs(cross(a, b, c)) > 1e-6 || Math.abs(cross(a, b, d)) > 1e-6) return 0;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const along = (p: Point) => ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length;
    const [from, to] = [along(c), along(d)].sort((x, y) => x - y) as [number, number];
    return Math.max(0, Math.min(length, to) - Math.max(0, from));
  }

  for (const layout of [WIDE_LAYOUT, NARROW_LAYOUT]) {
    it(`${layout.name}: no two wires share a stretch, so each shows its own health`, () => {
      const all = [...wires(layout)];
      for (const [i, [name, segments]] of all.entries()) {
        for (const [other, otherSegments] of all.slice(i + 1)) {
          for (const segment of segments) {
            for (const otherSegment of otherSegments) {
              assert.ok(sharedLength(segment, otherSegment) < 0.5, `${name} overlaps ${other}`);
            }
          }
        }
      }
    });

    it(`${layout.name}: every route runs from inside its source building to inside its target`, () => {
      const inside = (point: Point, centre: Point) =>
        Math.abs(point.x - centre.x) <= 66 && Math.abs(point.y - centre.y) <= 35;
      for (const { key, from, to } of RUNTIME_CONDUITS) {
        const route = layoutWires(layout).runtime[key];
        assert.ok(route.length >= 2, key);
        assert.ok(inside(route[0] as Point, layout.pieces[from]), `${key} starts in ${from}`);
        assert.ok(inside(route.at(-1) as Point, layout.pieces[to]), `${key} ends in ${to}`);
      }
    });

    it(`${layout.name}: feeds the capacitor from the registry (build) and Argo CD (deploy)`, () => {
      const { buildArm, deployArm } = layoutWires(layout);
      assert.deepEqual(buildArm[0], layout.pieces.ghcr);
      assert.deepEqual(buildArm.at(-1), layout.core);
      assert.deepEqual(deployArm[0], layout.pieces.argocd);
      assert.deepEqual(deployArm.at(-1), layout.core);
    });

    it(`${layout.name}: draws every piece and fits its drawing`, () => {
      const html = renderToStaticMarkup(
        createElement(ExplorerMap, { power: mapPower(steady(), NOW), now: NOW, layout }),
      );
      assert.match(html, new RegExp(`explorer-map--${layout.name}`));
      assert.match(html, new RegExp(`viewBox="0 0 ${layout.width} ${layout.height}"`));
      for (const { label } of MAP_NODES) assert.ok(html.includes(label), label);
      for (const { x, y } of Object.values(layout.pieces)) {
        assert.ok(x - 66 >= 0 && x + 66 <= layout.width && y - 35 >= 0 && y + 35 <= layout.height);
      }
    });
  }
});

describe('live snapshot', () => {
  const live = () => {
    const snapshot = sampleSnapshot('steady', NOW);
    assert.ok(snapshot);
    return JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
  };

  it('accepts exactly the API shape', () => {
    const value = live();
    assert.deepEqual(parseSnapshot(value), value);
    assert.deepEqual(parseSnapshot({ ...value, release: null })?.release, null);
  });

  it('rejects anything unexpected rather than drawing it', () => {
    const value = live();
    const components = value.components as Record<string, unknown>[];
    const bad = [
      null,
      'snapshot',
      { ...value, generatedAt: 'yesterday' },
      { ...value, sync: 'maybe' },
      { ...value, release: { commit: '', pinnedAt: value.generatedAt } },
      { ...value, components: [...components, components[0]] },
      { ...value, components: [{ ...components[0], id: 'database' }] },
      { ...value, components: [{ ...components[0], health: 'great' }] },
      {
        ...value,
        components: [{ ...components[0], replicas: { desired: -1, available: 0, ready: 0 } }],
      },
      { ...value, components: [{ ...components[0], version: 'x'.repeat(65) }] },
      { ...value, components: [{ ...components[0], traffic: 'heavy' }] },
    ];
    for (const candidate of bad)
      assert.equal(parseSnapshot(candidate), null, JSON.stringify(candidate).slice(0, 80));
  });

  const respond = (status: number, body: unknown) =>
    (async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
  const fetchWith = (impl: typeof fetch) =>
    fetchLiveSnapshot(
      'https://api.example.com/api/v1/infrastructure',
      AbortSignal.timeout(1_000),
      impl,
    );

  it('tells a snapshot, a disabled view, and every failure apart', async () => {
    assert.equal((await fetchWith(respond(200, live()))).kind, 'snapshot');
    assert.deepEqual(
      await fetchWith(respond(503, { error: { code: 'infrastructure_disabled', message: 'off' } })),
      { kind: 'disabled' },
    );
    for (const impl of [
      respond(503, { error: { code: 'infrastructure_unavailable', message: 'down' } }),
      respond(500, 'oops'),
      respond(200, 'not json'),
      respond(200, { generatedAt: 'nope' }),
      (async () => {
        throw new TypeError('network');
      }) as unknown as typeof fetch,
    ]) {
      assert.deepEqual(await fetchWith(impl), { kind: 'unavailable' });
    }
  });

  it('asks without cookies or caches', async () => {
    let init: RequestInit | undefined;
    await fetchWith((async (_url: string, options: RequestInit) => {
      init = options;
      return new Response(JSON.stringify(live()), { status: 200 });
    }) as unknown as typeof fetch);
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.cache, 'no-store');
  });

  it('fills in only the website, which the visitor is looking at', () => {
    const snapshot = sampleSnapshot('steady', NOW);
    assert.ok(snapshot);
    const unknownWeb = {
      ...snapshot,
      components: snapshot.components.map((component) =>
        component.id === 'web' || component.id === 'ai'
          ? { ...component, health: 'unknown' as const }
          : component,
      ),
    };
    const seen = withVisitorWebsite(unknownWeb);
    assert.equal(componentById(seen, 'web').health, 'healthy');
    assert.equal(componentById(seen, 'ai').health, 'unknown');
  });
});

describe('livePower', () => {
  const good = () => {
    const snapshot = sampleSnapshot('steady', NOW);
    assert.ok(snapshot);
    return { snapshot, receivedAt: NOW - 1_000 };
  };

  it('connects first, then shows the last good snapshot until it goes stale', () => {
    assert.deepEqual(livePower({ latest: null, good: null }, NOW), {
      on: false,
      reason: 'connecting',
    });
    assert.deepEqual(livePower({ latest: { kind: 'unavailable' }, good: null }, NOW), {
      on: false,
      reason: 'unavailable',
    });
    const kept = livePower({ latest: { kind: 'unavailable' }, good: good() }, NOW);
    assert.equal(kept.on, true, 'one failed refresh keeps the last good snapshot');
    assert.deepEqual(
      livePower({ latest: { kind: 'unavailable' }, good: good() }, NOW + STALE_AFTER_MS),
      {
        on: false,
        reason: 'stale',
      },
    );
  });

  it('powers down as soon as the API says the view is off', () => {
    assert.deepEqual(livePower({ latest: { kind: 'disabled' }, good: good() }, NOW), {
      on: false,
      reason: 'disabled',
    });
  });

  it('says why it is off, on the map and in the text view', () => {
    for (const reason of ['connecting', 'disabled', 'unavailable', 'stale'] as const) {
      const map = renderToStaticMarkup(
        createElement(ExplorerMap, { power: { on: false, reason }, now: NOW }),
      );
      assert.ok(map.includes(OFF_REASONS[reason].map), reason);
      assert.ok(!/healthy/i.test(map), `${reason}: never healthy without data`);
      const table = renderToStaticMarkup(
        createElement(ExplorerTable, { power: { on: false, reason }, now: NOW }),
      );
      assert.ok(table.includes(OFF_REASONS[reason].text), reason);
    }
  });
});

describe('InfrastructureExplorer without an API', () => {
  it('opens on the simulation, with the live switch off and disabled', () => {
    const html = renderToStaticMarkup(createElement(InfrastructureExplorer));
    assert.match(html, /role="switch"[^>]*aria-checked="false"[^>]*disabled=""/);
    assert.match(html, /Not available on this build/);
    assert.match(html, /Simulated scenario/);
  });
});
