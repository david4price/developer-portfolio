'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExplorerMap } from './explorer-map.tsx';
import { componentById, componentStatus, MAP_NODES, type MapPower, mapPower } from './map-model.ts';
import {
  SAMPLE_SCENARIOS,
  SCENARIO_LABELS,
  type SampleScenario,
  sampleSnapshot,
} from './sample-snapshots.ts';

/** How often the live map will refresh, matching the server's 10–15 s cache. */
export const REFRESH_MS = 12_000;

/** How often ages ("updated 7 s ago") and staleness are re-checked between refreshes. */
const CLOCK_MS = 1_000;

const SYNC_LABELS = { synced: 'Synced', 'out-of-sync': 'Out of sync', unknown: 'Unknown' } as const;

function secondsAgo(time: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(time)) / 1_000));
  return seconds < 120 ? `${seconds} s ago` : `${Math.round(seconds / 60)} min ago`;
}

/** The same data as the map, as text: the accessible view that needs no animation or colour. */
export function ExplorerTable({ power, now }: { readonly power: MapPower; readonly now: number }) {
  if (!power.on) {
    return (
      <p className="explorer-status" role="status">
        Status unavailable:{' '}
        {power.reason === 'stale'
          ? 'the last snapshot is too old to trust.'
          : 'the cluster status could not be loaded.'}
      </p>
    );
  }
  const { snapshot } = power;
  return (
    <table className="explorer-table">
      <caption>
        Updated {secondsAgo(snapshot.generatedAt, now)}. GitOps: {SYNC_LABELS[snapshot.sync]}.
        {snapshot.release !== null &&
          ` Latest release ${snapshot.release.commit}, pinned ${secondsAgo(snapshot.release.pinnedAt, now)}.`}
      </caption>
      <thead>
        <tr>
          <th scope="col">Component</th>
          <th scope="col">Status</th>
          <th scope="col">Version</th>
          <th scope="col">Traffic</th>
        </tr>
      </thead>
      <tbody>
        {MAP_NODES.map(({ id, label }) => {
          const component = componentById(snapshot, id);
          return (
            <tr key={id} data-health={component.health}>
              <th scope="row">{label}</th>
              <td>{componentStatus(component)}</td>
              <td>{component.version ?? '—'}</td>
              <td>{component.traffic ?? '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Prototype of the Infrastructure Explorer (P6-04) on sample data. The live version will fetch
 * the sanitized snapshot from the API every `REFRESH_MS` instead of picking a scenario.
 */
export function InfrastructureExplorer() {
  const [scenario, setScenario] = useState<SampleScenario>('steady');
  const [now, setNow] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);

  const [fetchedAt, setFetchedAt] = useState(() => Date.now());

  // The snapshot refreshes every REFRESH_MS (here: a new sample); the clock ticks every second,
  // so ages count up and a snapshot that stops refreshing goes stale on time.
  useEffect(() => {
    const refresh = setInterval(() => setFetchedAt(Date.now()), REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => {
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, []);

  // Animations stop while the tab is hidden.
  useEffect(() => {
    const update = () => setPaused(document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  const snapshot = useMemo(() => sampleSnapshot(scenario, fetchedAt), [scenario, fetchedAt]);
  const power = mapPower(snapshot, now);

  return (
    <section
      className="explorer"
      data-paused={paused ? 'true' : undefined}
      aria-label="Infrastructure map"
    >
      <p className="explorer-note">
        Prototype with sample data: this map is not connected to the live cluster yet. Lit windows
        show running replicas, sparks show traffic, and a red beacon marks a component that is down.
        The cluster&rsquo;s flux capacitor glows when deployed and pulses during a rollout.
      </p>
      <fieldset className="explorer-scenarios">
        <legend>Sample scenario</legend>
        {SAMPLE_SCENARIOS.map((option) => (
          <label key={option}>
            <input
              type="radio"
              name="explorer-scenario"
              value={option}
              checked={scenario === option}
              onChange={() => {
                const time = Date.now();
                setScenario(option);
                setFetchedAt(time);
                setNow(time);
              }}
            />
            {SCENARIO_LABELS[option]}
          </label>
        ))}
      </fieldset>
      <p className="visually-hidden" role="status">
        Showing the {SCENARIO_LABELS[scenario].toLowerCase()} sample
        {power.on ? '' : ': the map is powered off and the status is unavailable'}.
      </p>
      <div className="explorer-frame">
        <ExplorerMap power={power} now={now} />
      </div>
      <ExplorerTable power={power} now={now} />
    </section>
  );
}
