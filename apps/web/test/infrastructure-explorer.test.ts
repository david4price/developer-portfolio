import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { InfrastructureComponent, InfrastructureSnapshot } from '@portfolio/shared-types';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExplorerMap } from '../src/mini-apps/infrastructure-explorer/explorer-map.js';
import { ExplorerTable } from '../src/mini-apps/infrastructure-explorer/infrastructure-explorer.js';
import {
  componentById,
  componentStatus,
  conduitTraffic,
  MAP_NODES,
  mapPower,
  recentRelease,
  rolloutInProgress,
  STALE_AFTER_MS,
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
    assert.match(html, /role="img"/);
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
    for (const { label } of MAP_NODES) assert.ok(html.includes(`<th scope="row">${label}</th>`));

    const off = renderToStaticMarkup(
      createElement(ExplorerTable, { power: mapPower(null, NOW), now: NOW }),
    );
    assert.match(off, /role="status"/);
    assert.match(off, /Status unavailable/);
    assert.ok(!off.includes('<table'));
  });
});
