'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { apiUrl } from '../../lib/api.ts';
import type { InfrastructureSnapshot } from '@portfolio/shared-types';
import type { CardId } from './card-content.ts';
import { ExplorerCard } from './explorer-card.tsx';
import { ExplorerMap } from './explorer-map.tsx';
import { fetchLiveSnapshot, type LiveResult, withVisitorWebsite } from './live-snapshot.ts';
import {
  componentById,
  componentStatus,
  formatAge,
  MAP_NODES,
  mapPower,
  type MapPower,
  NARROW_LAYOUT,
  OFF_REASONS,
  STALE_AFTER_MS,
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
        {power.reason === 'connecting' ? 'Status: ' : 'Status unavailable: '}
        {OFF_REASONS[power.reason].text}
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
          ` GitOps revision ${snapshot.release.commit}, deployed ${formatAge(snapshot.release.pinnedAt, now)}.`}
      </p>
      <div className="explorer-table-frame">
        <table
          role="table"
          className="explorer-table"
          aria-label="Deployment status"
          aria-describedby={summaryId}
        >
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">
                Component
              </th>
              <th scope="col" role="columnheader">
                Status
              </th>
              <th scope="col" role="columnheader">
                Version
              </th>
              <th scope="col" role="columnheader">
                Traffic
              </th>
              {onSelect !== undefined && (
                <th scope="col" role="columnheader">
                  <span className="visually-hidden">Details</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {MAP_NODES.map(({ id, label }) => {
              const component = componentById(snapshot, id);
              return (
                <tr key={id} role="row" data-health={component.health}>
                  <th scope="row" role="rowheader">
                    {label}
                  </th>
                  <td role="cell" data-label="Status">
                    {componentStatus(component)}
                  </td>
                  <td role="cell" data-label="Version">
                    {component.version ?? '—'}
                  </td>
                  <td role="cell" data-label="Traffic">
                    {component.traffic ?? '—'}
                  </td>
                  {onSelect !== undefined && (
                    <td role="cell" className="explorer-table__action">
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

/** Longest a live request may take before it counts as unavailable. */
const LIVE_TIMEOUT_MS = 8_000;

type Mode = 'live' | 'simulation';

/** The last good live snapshot, already filled in from the visitor's side. */
interface GoodSnapshot {
  readonly snapshot: InfrastructureSnapshot;
  /**
   * When this snapshot's `generatedAt` was first seen, on the visitor's clock. A server that keeps
   * serving the same snapshot leaves it unchanged, so staleness never compares the visitor's clock
   * with the server's.
   */
  readonly freshSince: number;
}

export interface LiveState {
  /** The latest answer, or `null` before the first one (or after reconnecting). */
  readonly latest: LiveResult | null;
  /** Kept through failed refreshes until stale; cleared when the API says the view is off. */
  readonly good: GoodSnapshot | null;
}

export const NOT_CONNECTED: LiveState = { latest: null, good: null };

/** The live state after an answer arrives at `time`. */
export function receiveLive(previous: LiveState, result: LiveResult, time: number): LiveState {
  if (result.kind === 'disabled') return { latest: result, good: null };
  if (result.kind === 'unavailable') return { latest: result, good: previous.good };
  const sameSnapshot = previous.good?.snapshot.generatedAt === result.snapshot.generatedAt;
  return {
    latest: result,
    good: {
      snapshot: withVisitorWebsite(result.snapshot),
      freshSince: sameSnapshot && previous.good !== null ? previous.good.freshSince : time,
    },
  };
}

/**
 * What the live view shows: the last good snapshot until no new one has arrived for
 * `STALE_AFTER_MS` (refreshes failing, or the server stuck on an old snapshot); "disabled" as soon
 * as the API says the view is off; "connecting" before the first answer; "unavailable" when no
 * snapshot has arrived.
 */
export function livePower({ latest, good }: LiveState, now: number): MapPower {
  if (latest?.kind === 'disabled') return { on: false, reason: 'disabled' };
  if (good !== null) {
    return now - good.freshSince > STALE_AFTER_MS
      ? { on: false, reason: 'stale' }
      : { on: true, snapshot: good.snapshot };
  }
  return { on: false, reason: latest === null ? 'connecting' : 'unavailable' };
}

export interface InfrastructureExplorerProps {
  /** The live endpoint; `null` for a build without an API. Defaults to the build's API. */
  readonly liveUrl?: string | null;
}

/**
 * The Infrastructure Explorer (P6-04). Live by default: the sanitized snapshot from
 * `GET /api/v1/infrastructure`, refreshed every `REFRESH_MS`. Switching "Live data" off shows the
 * simulation instead, with sample scenarios to pick; a build without an API offers only that.
 */
export function InfrastructureExplorer({
  liveUrl = apiUrl('infrastructure'),
}: InfrastructureExplorerProps) {
  const [mode, setMode] = useState<Mode>(liveUrl === null ? 'simulation' : 'live');
  const [live, setLive] = useState<LiveState>(NOT_CONNECTED);
  const [scenario, setScenario] = useState<SampleScenario>('steady');
  const [now, setNow] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);
  const [card, setCard] = useState<CardId | null>(null);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  /** A live request skipped because the tab was hidden; made as soon as it is shown. */
  const skippedWhileHidden = useRef(false);

  /** When the current snapshot was asked for: a new sample, or the next live request. */
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const fetchedAtRef = useRef(fetchedAt);
  useEffect(() => {
    fetchedAtRef.current = fetchedAt;
  }, [fetchedAt]);
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

  // A refresh every REFRESH_MS (a new sample, or a live request); the clock ticks every second,
  // so ages count up and a snapshot that stops refreshing goes stale on time. Hidden tabs skip
  // both, so nothing re-renders or calls the API unseen.
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

  // Animations pause while the tab is hidden. Coming back refreshes if a refresh fell due (or one
  // was skipped). In live mode a refresh that fell due means the data may be stale, so the map
  // says "connecting" until the new answer instead of flashing "too old to trust".
  useEffect(() => {
    const update = () => {
      setPaused(document.hidden);
      if (document.hidden) return;
      const time = Date.now();
      setNow(time);
      const due = time - fetchedAtRef.current >= REFRESH_MS || skippedWhileHidden.current;
      skippedWhileHidden.current = false;
      if (!due) return;
      if (modeRef.current === 'live') setLive(NOT_CONNECTED);
      setFetchedAt(time);
    };
    setPaused(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  // Live: one request per refresh, never from a hidden tab. A timeout counts as unavailable; a
  // request the view moved on from (a newer refresh, simulation, or unmounting) is dropped.
  useEffect(() => {
    if (mode !== 'live' || liveUrl === null) return;
    if (document.hidden) {
      skippedWhileHidden.current = true;
      return;
    }
    let current = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
    void fetchLiveSnapshot(liveUrl, controller.signal).then((result) => {
      clearTimeout(timeout);
      if (!current) return;
      const time = Date.now();
      setLive((previous) => receiveLive(previous, result, time));
      setNow(time);
    });
    return () => {
      current = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [mode, liveUrl, fetchedAt]);

  const sample = useMemo(
    () => (mode === 'simulation' ? sampleSnapshot(scenario, fetchedAt) : null),
    [mode, scenario, fetchedAt],
  );
  const power = mode === 'live' ? livePower(live, now) : mapPower(sample, now, fetchedAt);

  const switchMode = (next: Mode) => {
    const time = Date.now();
    if (next === 'live') setLive(NOT_CONNECTED);
    setMode(next);
    setFetchedAt(time);
    setNow(time);
  };

  const status =
    mode === 'live'
      ? power.on
        ? 'Showing live data.'
        : `Showing live data: ${OFF_REASONS[power.reason].text}`
      : `Showing the simulated ${SCENARIO_LABELS[scenario].toLowerCase()} scenario${
          power.on ? '.' : ': the map is powered off.'
        }`;

  return (
    <section
      className="explorer"
      data-paused={paused ? 'true' : undefined}
      aria-label="Infrastructure map"
    >
      <p className="explorer-note">
        Lit windows show running replicas, sparks show traffic, and a red beacon marks a component
        that is down. The cluster&rsquo;s flux capacitor glows when deployed and pulses during a
        rollout. Select any building or the capacitor for its card.
      </p>
      <div className="explorer-controls">
        <button
          type="button"
          role="switch"
          className="explorer-switch"
          aria-checked={mode === 'live'}
          disabled={liveUrl === null}
          onClick={() => switchMode(mode === 'live' ? 'simulation' : 'live')}
        >
          <span className="explorer-switch__track" aria-hidden="true">
            <span className="explorer-switch__thumb" />
          </span>
          Live data
        </button>
        <span className="explorer-controls__note">
          {liveUrl === null
            ? 'Not available on this build: showing the simulation.'
            : mode === 'live'
              ? `The real cluster, refreshed every ${REFRESH_MS / 1_000} s.`
              : 'Simulation: pick a scenario to see how the map reacts.'}
        </span>
      </div>
      {mode === 'simulation' && (
        <fieldset className="explorer-scenarios">
          <legend>Simulated scenario</legend>
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
      )}
      <p className="visually-hidden" role="status">
        {status}
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
