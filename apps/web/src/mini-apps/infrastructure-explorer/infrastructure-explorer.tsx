'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import type { CardId } from './card-content.ts';
import { ExplorerCard } from './explorer-card.tsx';
import { ExplorerMap } from './explorer-map.tsx';
import {
  componentById,
  componentStatus,
  formatAge,
  MAP_NODES,
  type MapPower,
  mapPower,
  NARROW_LAYOUT,
  SYNC_LABELS,
  WIDE_LAYOUT,
} from './map-model.ts';
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

/** Screens this narrow get the portrait layout. */
const NARROW_QUERY = '(max-width: 640px)';

export interface ExplorerTableProps {
  readonly power: MapPower;
  readonly now: number;
  /** Opens a component's card; without it, the table has no buttons. */
  readonly onSelect?: (id: CardId) => void;
}

/** The same data as the map, as text: the accessible view that needs no animation or colour. */
export function ExplorerTable({ power, now, onSelect }: ExplorerTableProps) {
  const summaryId = useId();
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
  // The summary sits above the table, not in a caption, so it wraps to the screen while the table
  // scrolls inside its frame on a phone.
  return (
    <div className="explorer-table-block">
      <p id={summaryId} className="explorer-table__summary">
        Updated {formatAge(snapshot.generatedAt, now)}. GitOps: {SYNC_LABELS[snapshot.sync]}.
        {snapshot.release !== null &&
          ` Latest release ${snapshot.release.commit}, pinned ${formatAge(snapshot.release.pinnedAt, now)}.`}
      </p>
      <div className="explorer-table-frame">
        <table
          className="explorer-table"
          aria-label="Deployment status"
          aria-describedby={summaryId}
        >
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col">Status</th>
              <th scope="col">Version</th>
              <th scope="col">Traffic</th>
              {onSelect !== undefined && (
                <th scope="col">
                  <span className="visually-hidden">Details</span>
                </th>
              )}
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
                  {onSelect !== undefined && (
                    <td>
                      <button
                        type="button"
                        className="explorer-table__details"
                        aria-haspopup="dialog"
                        onClick={() => onSelect(id)}
                      >
                        Details<span className="visually-hidden"> for {label}</span>
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
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
  const [card, setCard] = useState<CardId | null>(null);

  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  );

  // Phones get the portrait layout; rotating or resizing switches between them.
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // The snapshot refreshes every REFRESH_MS (here: a new sample); the clock ticks every second,
  // so ages count up and a snapshot that stops refreshing goes stale on time. Hidden tabs skip
  // both, so nothing re-renders unseen.
  useEffect(() => {
    const refresh = setInterval(() => {
      if (!document.hidden) setFetchedAt(Date.now());
    }, REFRESH_MS);
    const clock = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, CLOCK_MS);
    return () => {
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, []);

  // Animations pause while the tab is hidden. Coming back updates the clock, and refreshes too if
  // a refresh fell due meanwhile, before anything renders, so a fresh snapshot never flashes stale.
  useEffect(() => {
    const update = () => {
      setPaused(document.hidden);
      if (document.hidden) return;
      const time = Date.now();
      setNow(time);
      setFetchedAt((previous) => (time - previous >= REFRESH_MS ? time : previous));
    };
    setPaused(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  const snapshot = useMemo(() => sampleSnapshot(scenario, fetchedAt), [scenario, fetchedAt]);
  const power = mapPower(snapshot, now, fetchedAt);

  return (
    <section
      className="explorer"
      data-paused={paused ? 'true' : undefined}
      aria-label="Infrastructure map"
    >
      <p className="explorer-note">
        Prototype with sample data: this map is not connected to the live cluster yet. Lit windows
        show running replicas, sparks show traffic, and a red beacon marks a component that is down.
        The cluster&rsquo;s flux capacitor glows when deployed and pulses during a rollout. Select
        any building or the capacitor for its card.
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
        <ExplorerMap
          power={power}
          now={now}
          layout={narrow ? NARROW_LAYOUT : WIDE_LAYOUT}
          onSelect={setCard}
        />
      </div>
      <ExplorerTable power={power} now={now} onSelect={setCard} />
      <ExplorerCard id={card} power={power} now={now} onClose={() => setCard(null)} />
    </section>
  );
}
