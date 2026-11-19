'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

export interface InterestPhoto {
  readonly file: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

export interface InterestCardProps {
  readonly name: string;
  readonly description: string;
  readonly photos?: readonly InterestPhoto[] | undefined;
}

/** Prints peeking out from behind a card: decoration only, the button opens the real photos. */
const PEEKING = 3;

/** A press that moves less than this many pixels is a click or tap, not a drag. */
const TAP_SLOP = 8;

const small = (photo: InterestPhoto) => `/photos/${photo.file}-sm.webp`;
const large = (photo: InterestPhoto) => `/photos/${photo.file}-lg.webp`;

/**
 * One interest. With photos, a few prints peek out from behind the card, and its button opens
 * them all as white-framed prints in a native dialog. A print enlarges inside the dialog, so the
 * visitor never leaves the page: Previous/Next or the arrow keys move between photos, and Esc or
 * "Back to all photos" returns to the prints (Esc again, Close, or a click outside closes the
 * dialog, and focus returns to what opened it). A click on the enlarged photo (or the "Bigger"
 * button) shows the whole print bigger, at the file's full size, in a dialog widened to the window:
 * the clicked spot stays in view, and dragging, scrolling, or swiping moves around it. Another
 * click fits it to the screen again.
 *
 * The images are plain `img` elements: next/image adds an inline style, which the CSP
 * (`style-src 'self'`) blocks, and the files are already resized WebP.
 */
export function InterestCard({ name, description, photos = [] }: InterestCardProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const prints = useRef<(HTMLButtonElement | null)[]>([]);
  const viewer = useRef<HTMLDivElement>(null);
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();
  /** The enlarged photo's index, or `null` while the prints are shown. */
  const [shown, setShown] = useState<number | null>(null);
  /** The print to focus again when going back from the enlarged view. */
  const returnTo = useRef<number | null>(null);
  /** Bigger: the enlarged print at its file's full size, in a scrollable viewport. */
  const [zoomed, setZoomed] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const photo = useRef<HTMLImageElement>(null);
  /** Where in the photo (0–1 across and down) to keep in view when it grows. */
  const focusAt = useRef({ x: 0.5, y: 0.5 });
  /** Where a press started, to tell a click (toggle) from a drag (moving around). */
  const pressedAt = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const toggleZoom = (event?: PointerEvent<HTMLImageElement>) => {
    const image = photo.current;
    if (event !== undefined && image !== null) {
      const rect = image.getBoundingClientRect();
      focusAt.current = {
        x: rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5,
        y: rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5,
      };
    } else {
      focusAt.current = { x: 0.5, y: 0.5 };
    }
    setZoomed((value) => !value);
  };

  // Once the print has grown, scroll so the clicked spot sits in the middle of the view (the
  // browser clamps the position to what it can scroll).
  // The bigger view takes focus, so the arrow keys scroll it; fitted again, the viewer has it.
  const wasZoomed = useRef(false);
  useLayoutEffect(() => {
    const view = viewport.current;
    const image = photo.current;
    if (zoomed && view !== null && image !== null) {
      view.scrollLeft =
        image.offsetLeft + focusAt.current.x * image.offsetWidth - view.clientWidth / 2;
      view.scrollTop =
        image.offsetTop + focusAt.current.y * image.offsetHeight - view.clientHeight / 2;
      view.focus({ preventScroll: true });
    } else if (!zoomed && wasZoomed.current) {
      viewer.current?.focus({ preventScroll: true });
    }
    wasZoomed.current = zoomed;
  }, [zoomed]);

  const open = () => {
    setShown(null);
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();
  const enlarge = (index: number) => {
    returnTo.current = index;
    setShown(index);
  };
  const back = () => setShown(null);
  const step = (by: number) => {
    if (shown === null) return;
    const next = (shown + by + photos.length) % photos.length;
    // "Back to all photos" returns to the print being viewed, not the first one opened.
    returnTo.current = next;
    setShown(next);
  };

  // Each photo, and going back to the prints, starts unzoomed.
  useEffect(() => setZoomed(false), [shown]);

  // Entering from the prints, the viewer takes focus; stepping between photos leaves focus where
  // it is (on Next or Previous); going back, the print being viewed gets it.
  const wasShown = useRef<number | null>(null);
  useEffect(() => {
    if (shown !== null && wasShown.current === null) {
      viewer.current?.focus();
    } else if (shown === null && returnTo.current !== null) {
      prints.current[returnTo.current]?.focus();
      returnTo.current = null;
    }
    wasShown.current = shown;
  }, [shown]);

  const onViewerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // Bigger, the arrow keys scroll the photo (the focused view), not change it.
    if (zoomed) return;
    if (event.key === 'ArrowRight') step(1);
    else if (event.key === 'ArrowLeft') step(-1);
    else return;
    event.preventDefault();
  };

  const current = shown === null ? undefined : photos[shown];

  return (
    <li className="interest-card">
      {photos.length > 0 && (
        <div className="interest-card__prints" aria-hidden="true" onClick={open}>
          {photos.slice(0, PEEKING).map((photo) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photo.file}
              src={small(photo)}
              alt=""
              width={photo.width}
              height={photo.height}
              loading="lazy"
              decoding="async"
            />
          ))}
        </div>
      )}
      {/* The card is a sibling in front of its prints, so they can sit behind it. */}
      <div className="ui-card interest-card__body">
        <h3 className="ui-card__title">{name}</h3>
        <p>{description}</p>
        {photos.length > 0 && (
          <>
            <button type="button" className="interest-card__open" onClick={open}>
              {photos.length === 1 ? 'See the photo' : `See all ${photos.length} photos`}
            </button>
            <dialog
              ref={dialog}
              className={zoomed ? 'photo-dialog is-zoomed' : 'photo-dialog'}
              aria-labelledby={titleId}
              onCancel={(event) => {
                // Esc steps back from an enlarged photo before it closes the dialog.
                if (shown !== null) {
                  event.preventDefault();
                  back();
                }
              }}
              onClose={() => {
                // The browser returns focus to the opener; no print should take it back.
                returnTo.current = null;
                setShown(null);
              }}
              onPointerDown={(event) => {
                pressedOnBackdrop.current = event.target === event.currentTarget;
              }}
              onClick={(event) => {
                // A click on the backdrop lands on the dialog itself, outside its content. Only a
                // press that also started there closes: a drag released past the edge doesn't.
                if (event.target === event.currentTarget && pressedOnBackdrop.current) close();
                pressedOnBackdrop.current = false;
              }}
            >
              <div className="photo-dialog__content">
                <div className="photo-dialog__header">
                  <h3 id={titleId}>{name}</h3>
                  <button type="button" onClick={close}>
                    Close
                  </button>
                </div>
                {current === undefined || shown === null ? (
                  <ul className="photo-grid">
                    {photos.map((photo, index) => (
                      <li key={photo.file}>
                        <button
                          type="button"
                          className="photo-print"
                          ref={(element) => {
                            prints.current[index] = element;
                          }}
                          onClick={() => enlarge(index)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={small(photo)}
                            alt={photo.alt}
                            width={photo.width}
                            height={photo.height}
                            loading="lazy"
                            decoding="async"
                          />
                          <span className="visually-hidden">(enlarge)</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div
                    ref={viewer}
                    className="photo-viewer"
                    tabIndex={-1}
                    role="group"
                    aria-roledescription="photo viewer"
                    aria-label={`Photo ${shown + 1} of ${photos.length}`}
                    onKeyDown={onViewerKey}
                  >
                    <div
                      ref={viewport}
                      className={zoomed ? 'photo-viewer__print is-zoomed' : 'photo-viewer__print'}
                      // Bigger, it scrolls: focusable, so the arrow keys move around the photo.
                      tabIndex={zoomed ? 0 : undefined}
                      role={zoomed ? 'region' : undefined}
                      aria-label={
                        zoomed ? 'Bigger photo, use the arrow keys to move around' : undefined
                      }
                    >
                      {/* The print's white border, around the photo at either size. */}
                      <div className="photo-viewer__frame">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          key={current.file}
                          ref={photo}
                          src={large(current)}
                          alt={current.alt}
                          width={current.width}
                          height={current.height}
                          decoding="async"
                          draggable={false}
                          onPointerDown={(event) => {
                            const view = viewport.current;
                            pressedAt.current = {
                              x: event.clientX,
                              y: event.clientY,
                              left: view?.scrollLeft ?? 0,
                              top: view?.scrollTop ?? 0,
                            };
                          }}
                          onPointerMove={(event) => {
                            // Drag with the mouse to move around a bigger print; touch scrolls
                            // natively.
                            const start = pressedAt.current;
                            const view = viewport.current;
                            if (!zoomed || start === null || view === null) return;
                            if (event.pointerType !== 'mouse' || event.buttons === 0) return;
                            view.scrollLeft = start.left - (event.clientX - start.x);
                            view.scrollTop = start.top - (event.clientY - start.y);
                          }}
                          onPointerUp={(event) => {
                            const start = pressedAt.current;
                            pressedAt.current = null;
                            // A click or tap toggles the size; a drag doesn't.
                            const moved =
                              start === null
                                ? 0
                                : Math.hypot(event.clientX - start.x, event.clientY - start.y);
                            if (event.button === 0 && moved < TAP_SLOP) toggleZoom(event);
                          }}
                          onPointerCancel={() => {
                            pressedAt.current = null;
                          }}
                        />
                      </div>
                    </div>
                    <div className="photo-viewer__controls">
                      <span className="photo-viewer__nav">
                        <button type="button" onClick={back}>
                          Back to all photos
                        </button>
                        <button type="button" aria-pressed={zoomed} onClick={() => toggleZoom()}>
                          {zoomed ? 'Fit to screen' : 'Bigger'}
                        </button>
                      </span>
                      {photos.length > 1 && (
                        <span className="photo-viewer__nav">
                          <button type="button" onClick={() => step(-1)}>
                            <span aria-hidden="true">←</span> Previous
                          </button>
                          <span className="photo-viewer__count" aria-hidden="true">
                            {shown + 1} / {photos.length}
                          </span>
                          <button type="button" onClick={() => step(1)}>
                            Next <span aria-hidden="true">→</span>
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </dialog>
          </>
        )}
      </div>
    </li>
  );
}
