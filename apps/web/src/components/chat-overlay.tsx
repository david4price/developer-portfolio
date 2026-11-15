'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Dialog {
  readonly open: boolean;
  showModal(): void;
  close(): void;
}

/** Use the browser's top layer and focus trap; restore focus to the artwork button on close. */
export function openChatDialog(dialog: Dialog, launcher: { focus(): void }): () => void {
  if (!dialog.open) dialog.showModal();
  return () => {
    if (dialog.open) dialog.close();
    launcher.focus();
  };
}

export function outsideDialog(
  point: { readonly clientX: number; readonly clientY: number },
  bounds: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  },
): boolean {
  return (
    point.clientX < bounds.left ||
    point.clientX > bounds.right ||
    point.clientY < bounds.top ||
    point.clientY > bounds.bottom
  );
}

interface Props {
  /** The dog companion's name, shown in the popup title. */
  readonly assistantName: string;
  readonly open: boolean;
  readonly waiting?: boolean;
  readonly loaded?: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly children?: ReactNode;
}

function ChatDog({ pose }: { readonly pose: 'lying' | 'sitting' | 'standing' }) {
  const poses = pose === 'lying' ? (['lying'] as const) : (['sitting', 'standing'] as const);
  return (
    <span className="chat-dog" data-pose={pose} aria-hidden="true">
      {poses.map((value) => (
        <span key={value} className={`chat-dog__pose chat-dog__pose--${value}`} />
      ))}
    </span>
  );
}

export function ChatOverlay({
  open,
  waiting = false,
  loaded = false,
  onOpen,
  onClose,
  children,
  assistantName,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open || dialog.current === null || launcher.current === null) return;
    return openChatDialog(dialog.current, launcher.current);
  }, [open]);

  return (
    <>
      <button
        ref={launcher}
        type="button"
        className="chat-launcher"
        aria-label="Open portfolio chat"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-dialog`}
        title="Chat about the portfolio"
        onClick={onOpen}
      >
        <ChatDog pose="lying" />
      </button>
      <dialog
        ref={dialog}
        id={`${id}-dialog`}
        className="chat-popup"
        aria-labelledby={`${id}-title`}
        onClose={onClose}
        onClick={(event) => {
          if (
            event.target === event.currentTarget &&
            outsideDialog(event, event.currentTarget.getBoundingClientRect())
          )
            onClose();
        }}
      >
        <div className="chat-popup__bubble">
          <header className="chat-popup__header">
            <h2 id={`${id}-title`}>Chat with {assistantName}</h2>
            <button
              type="button"
              className="chat-popup__close"
              onClick={onClose}
              aria-label="Close portfolio chat"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div className="chat-popup__body">{children}</div>
        </div>
        <button
          type="button"
          className="chat-popup__dog"
          onClick={onClose}
          aria-label="Close portfolio chat"
          title="Close chat"
        >
          {(open || loaded) && <ChatDog pose={waiting ? 'standing' : 'sitting'} />}
        </button>
      </dialog>
    </>
  );
}
