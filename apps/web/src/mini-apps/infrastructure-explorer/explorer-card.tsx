'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { outsideDialog } from '../../components/chat-overlay.tsx';
import { type CardDetails, type CardId, cardDetails } from './card-content.ts';
import { MapPiece } from './explorer-map.tsx';
import type { MapPower } from './map-model.ts';

/** The back of a card: what the piece is, its live facts, and where to read more. */
export function CardBack({ details, titleId }: { details: CardDetails; titleId?: string }) {
  return (
    <>
      <h2 id={titleId} className="explorer-card__title">
        {details.title}
      </h2>
      <p className="explorer-card__subtitle">{details.subtitle}</p>
      <p className="explorer-card__about">{details.about}</p>
      {details.facts.length > 0 ? (
        <dl className="explorer-card__facts">
          {details.facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="explorer-card__no-facts">{details.noFacts}</p>
      )}
      {details.more !== null && (
        <a
          className="explorer-card__more"
          href={details.more.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Read more: {details.more.title}
          <span aria-hidden="true"> ↗</span>
          <span className="visually-hidden"> (on GitHub, opens in a new tab)</span>
        </a>
      )}
    </>
  );
}

export interface ExplorerCardProps {
  /** The open card, or `null` when none is open. */
  readonly id: CardId | null;
  readonly power: MapPower;
  readonly now: number;
  readonly onClose: () => void;
}

/**
 * A pop-up card for one piece of the map. It opens with a flip from its front (the piece close up)
 * to its details; a button flips it back. Only the visible face is interactive.
 */
export function ExplorerCard({ id, power, now, onClose }: ExplorerCardProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frontButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  // Cards open on their details, so focus lands there once and never jumps; the flip from the
  // front plays as the opening animation (CSS), and the buttons flip it by hand afterwards.
  const [flipped, setFlipped] = useState(true);

  useEffect(() => {
    const element = dialog.current;
    if (id === null || element === null) return;
    setFlipped(true);
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, [id]);

  // Keep focus on the face that's showing; the hidden face is inert.
  useEffect(() => {
    if (id === null) return;
    (flipped ? backButton : frontButton).current?.focus();
  }, [flipped, id]);

  const details = id === null ? null : cardDetails(id, power, now);
  return (
    <dialog
      ref={dialog}
      className="explorer-card"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (
          event.target === event.currentTarget &&
          outsideDialog(event, event.currentTarget.getBoundingClientRect())
        ) {
          onClose();
        }
      }}
    >
      {id !== null && details !== null && (
        <div className="explorer-card__flipper" data-flipped={flipped ? 'true' : undefined}>
          <section className="explorer-card__face explorer-card__face--front" inert={flipped}>
            <MapPiece id={id} power={power} />
            <div className="explorer-card__actions">
              <button ref={frontButton} type="button" onClick={() => setFlipped(true)}>
                Show details
              </button>
              <button type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </section>
          <section className="explorer-card__face explorer-card__face--back" inert={!flipped}>
            <CardBack details={details} titleId={titleId} />
            <div className="explorer-card__actions">
              <button ref={backButton} type="button" onClick={() => setFlipped(false)}>
                Flip back
              </button>
              <button type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </section>
        </div>
      )}
    </dialog>
  );
}
