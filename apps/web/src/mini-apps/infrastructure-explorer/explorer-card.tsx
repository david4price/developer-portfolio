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

interface CardFacesProps {
  readonly id: CardId;
  readonly power: MapPower;
  readonly now: number;
  readonly titleId: string;
  readonly onClose: () => void;
}

/**
 * The two faces of an open card. Keyed by piece, so each opening starts here: on the details,
 * with the flip from the front playing as the opening animation. While it plays, both faces are
 * inert and the dialog holds focus; when it ends, focus moves to the details.
 */
function CardFaces({ id, power, now, titleId, onClose }: CardFacesProps) {
  const frontButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const [flipped, setFlipped] = useState(true);
  const [opening, setOpening] = useState(
    () =>
      typeof window !== 'undefined' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (opening) return;
    (flipped ? backButton : frontButton).current?.focus();
  }, [flipped, opening]);

  const details = cardDetails(id, power, now);
  return (
    <div
      className="explorer-card__flipper"
      data-flipped={flipped ? 'true' : undefined}
      data-opening={opening ? 'true' : undefined}
      onAnimationEnd={(event) => {
        // Only the flipper's own opening flip counts, not animations inside it.
        if (event.target === event.currentTarget) setOpening(false);
      }}
    >
      <section
        className="explorer-card__face explorer-card__face--front"
        inert={opening || flipped}
      >
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
      <section
        className="explorer-card__face explorer-card__face--back"
        inert={opening || !flipped}
      >
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
  );
}

/**
 * A pop-up card for one piece of the map. The dialog stays mounted, so closing it returns focus
 * to the piece that opened it; only its faces are replaced for each piece.
 */
export function ExplorerCard({ id, power, now, onClose }: ExplorerCardProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (id === null || element === null) return;
    if (!element.open) element.showModal();
    element.focus();
    return () => {
      if (element.open) element.close();
    };
  }, [id]);

  return (
    <dialog
      ref={dialog}
      className="explorer-card"
      aria-labelledby={titleId}
      tabIndex={-1}
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
      {id !== null && (
        <CardFaces key={id} id={id} power={power} now={now} titleId={titleId} onClose={onClose} />
      )}
    </dialog>
  );
}
