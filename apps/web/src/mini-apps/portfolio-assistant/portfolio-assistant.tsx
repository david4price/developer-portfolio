'use client';

import { CHAT_MESSAGE_MAX_LENGTH } from '@portfolio/shared-types';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { apiUrl } from '@/lib/api';
import { assistantName } from '@/lib/assistant';
import { ChatRequestError, createChatSession, sendChatMessage } from '@/lib/chat';
import { FINE_POINTER_QUERY, sendsOnEnter } from '@/lib/chat-keys';
import { TurnstileChallenge } from '@/components/turnstile-challenge';
import { appendChatEntry, ChatConversation, type ChatEntry } from '@/components/chat-conversation';

const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null;
type Phase = 'verify' | 'starting' | 'ready' | 'sending';
/** Offered under the greeting until the first question; each is answerable from the registry. */
const STARTER_QUESTIONS = [
  'What is this site built with?',
  'How is this site deployed?',
  'What is the Infrastructure Explorer?',
] as const;
/** The character counter appears only near the limit. */
const COUNTER_FROM = Math.floor(CHAT_MESSAGE_MAX_LENGTH * 0.8);
/** A reply taller than this share of the visible log is shown from its start, not its end. */
const LONG_REPLY = 0.6;
/** How much of the question above stays visible when a long reply is shown from its start. */
const QUESTION_PEEK_PX = 48;

function scrollToEnd(log: HTMLElement) {
  log.scrollTop = log.scrollHeight;
}

/** A new reply: from its start when it is long (so it is read from the top), else the bottom. */
function revealLatestReply(log: HTMLElement) {
  const replies = log.querySelectorAll('[data-reply]');
  const reply = replies[replies.length - 1];
  if (reply === undefined || reply.clientHeight <= log.clientHeight * LONG_REPLY) {
    scrollToEnd(log);
    return;
  }
  log.scrollTop +=
    reply.getBoundingClientRect().top - log.getBoundingClientRect().top - QUESTION_PEEK_PX;
}

export function PortfolioChat({
  active,
  onNavigate,
  onWaitingChange,
}: {
  readonly active: boolean;
  readonly onNavigate: () => void;
  readonly onWaitingChange: (waiting: boolean) => void;
}) {
  const sessionsUrl = apiUrl('chat/sessions');
  const messagesUrl = apiUrl('chat/messages');
  const [phase, setPhase] = useState<Phase>('verify');
  const [token, setToken] = useState<string | null>(null);
  const [challengeKey, setChallengeKey] = useState(0);
  const [verificationFailed, setVerificationFailed] = useState(false);
  const [notice, setNotice] = useState('');
  const [message, setMessage] = useState('');
  const [entries, setEntries] = useState<readonly ChatEntry[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const nextEntryId = useRef(0);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    onWaitingChange(phase === 'sending');
    return () => onWaitingChange(false);
  }, [phase, onWaitingChange]);
  useEffect(() => {
    if (!active) setToken(null);
  }, [active]);
  useEffect(() => {
    if (active && phase === 'ready') input.current?.focus();
  }, [active, phase]);
  // Only new content moves the view: a reply, a waiting question, or a problem to read.
  useEffect(() => {
    if (log.current !== null) revealLatestReply(log.current);
  }, [entries]);
  useEffect(() => {
    if (log.current !== null && (pending !== null || notice !== '')) scrollToEnd(log.current);
  }, [pending, notice]);
  const onToken = useCallback((value: string | null) => {
    setToken(value);
    if (value !== null) setVerificationFailed(false);
  }, []);
  const onUnavailable = useCallback(() => {
    setVerificationFailed(true);
  }, []);

  function resetVerification() {
    setToken(null);
    setVerificationFailed(false);
    setChallengeKey((value) => value + 1);
  }

  async function start() {
    if (sessionsUrl === null || token === null || request.current !== null) return;
    const controller = new AbortController();
    request.current = controller;
    setPhase('starting');
    setNotice('');
    // Unmount the widget and discard the token before sending it, even if the request fails.
    const freshToken = token;
    setToken(null);
    try {
      await createChatSession(sessionsUrl, freshToken, controller.signal);
      if (!controller.signal.aborted) {
        setEntries([]);
        setPhase('ready');
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotice(error instanceof ChatRequestError ? error.message : 'Chat is unavailable.');
        resetVerification();
        setPhase('verify');
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(message.trim());
  }

  /** Sends a typed question or a chosen starter question. */
  async function submit(question: string) {
    if (messagesUrl === null || phase !== 'ready' || !question || request.current !== null) return;
    const controller = new AbortController();
    request.current = controller;
    setPhase('sending');
    setNotice('');
    // Show the question at once, like a messenger; it returns to the input if sending fails.
    setPending(question);
    setMessage('');
    let nextPhase: Phase = 'ready';
    try {
      const answer = await sendChatMessage(messagesUrl, question, controller.signal);
      if (!controller.signal.aborted) {
        const entry = { id: nextEntryId.current++, question, answer };
        setEntries((current) => appendChatEntry(current, entry));
      }
    } catch (error) {
      setMessage(question);
      if (!controller.signal.aborted) {
        setNotice(error instanceof ChatRequestError ? error.message : 'Chat is unavailable.');
        if (error instanceof ChatRequestError && error.code === 'chat_session_required') {
          nextPhase = 'verify';
          resetVerification();
        }
      }
    } finally {
      if (request.current === controller) request.current = null;
      setPending(null);
      if (!controller.signal.aborted) {
        setPhase(nextPhase);
      }
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const finePointer = window.matchMedia(FINE_POINTER_QUERY).matches;
    const press = {
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
    };
    if (!sendsOnEnter(press, finePointer)) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  if (sessionsUrl === null || messagesUrl === null || siteKey === null) {
    return (
      <p role="status">
        Chat is not configured for this build. You can still explore the projects.
      </p>
    );
  }

  const started = phase === 'ready' || phase === 'sending';
  const status =
    phase === 'starting'
      ? 'Starting chat…'
      : phase === 'sending'
        ? `${assistantName} is thinking…`
        : phase === 'ready'
          ? 'Chat is ready.'
          : '';
  return (
    <section className="chat" aria-label="Portfolio chat">
      <div className="chat-scroll" ref={log}>
        <p className="chat-intro">
          Ask about the projects and technologies in this portfolio. Answers may contain mistakes.
          Messages are kept for up to 24 hours; please avoid sharing personal information.
        </p>
        <ChatConversation
          assistantName={assistantName}
          greeting={started}
          entries={entries}
          pending={pending}
          suggestions={phase === 'ready' && entries.length === 0 ? STARTER_QUESTIONS : []}
          onSuggestion={(question) => void submit(question)}
          renderLink={(link) => (
            <Link href={link.path} onNavigate={onNavigate}>
              {link.title}
            </Link>
          )}
        />
        {/* Problems are shown; routine progress is for screen readers (the typing dots show it). */}
        <p role="status" aria-live="polite" className={notice ? 'chat-notice' : 'visually-hidden'}>
          {notice || status}
        </p>
        {phase === 'verify' && (
          <div className="chat-verify">
            <p>Complete the verification to start a new chat.</p>
            {active && (
              <TurnstileChallenge
                key={challengeKey}
                siteKey={siteKey}
                onToken={onToken}
                onUnavailable={onUnavailable}
              />
            )}
            {verificationFailed && (
              <p role="status">
                Verification is unavailable.{' '}
                <button type="button" onClick={resetVerification}>
                  Retry verification
                </button>
              </p>
            )}
            <button type="button" onClick={() => void start()} disabled={token === null}>
              Start chat
            </button>
          </div>
        )}
      </div>
      {started && (
        <form className="chat-composer" onSubmit={onSubmit}>
          <label htmlFor="chat-message" className="visually-hidden">
            Message {assistantName}
          </label>
          <div className="chat-composer__row">
            <textarea
              ref={input}
              id="chat-message"
              value={message}
              maxLength={CHAT_MESSAGE_MAX_LENGTH}
              required
              rows={1}
              placeholder={`Message ${assistantName}…`}
              aria-describedby="chat-message-hint"
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={onComposerKeyDown}
              readOnly={phase === 'sending'}
            />
            <button type="submit" disabled={phase === 'sending' || !message.trim()}>
              Send
            </button>
          </div>
          <p id="chat-message-hint" className="chat-note chat-composer__hint">
            {message.length >= COUNTER_FROM ? (
              `${message.length} / ${CHAT_MESSAGE_MAX_LENGTH} characters`
            ) : (
              <span className="chat-composer__keys">Enter to send, Shift+Enter for a new line</span>
            )}
          </p>
        </form>
      )}
    </section>
  );
}
