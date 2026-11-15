'use client';

import { CHAT_MESSAGE_MAX_LENGTH } from '@portfolio/shared-types';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { apiUrl } from '@/lib/api';
import { assistantName } from '@/lib/assistant';
import { ChatRequestError, createChatSession, sendChatMessage } from '@/lib/chat';
import { TurnstileChallenge } from '@/components/turnstile-challenge';
import { appendChatEntry, ChatConversation, type ChatEntry } from '@/components/chat-conversation';

const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null;
type Phase = 'verify' | 'starting' | 'ready' | 'sending';

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

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = message.trim();
    if (messagesUrl === null || phase !== 'ready' || !question || request.current !== null) return;
    const controller = new AbortController();
    request.current = controller;
    setPhase('sending');
    setNotice('');
    let nextPhase: Phase = 'ready';
    try {
      const answer = await sendChatMessage(messagesUrl, question, controller.signal);
      if (!controller.signal.aborted) {
        const entry = { id: nextEntryId.current++, question, answer };
        setEntries((current) => appendChatEntry(current, entry));
        setMessage('');
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotice(error instanceof ChatRequestError ? error.message : 'Chat is unavailable.');
        if (error instanceof ChatRequestError && error.code === 'chat_session_required') {
          nextPhase = 'verify';
          resetVerification();
        }
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) {
        setPhase(nextPhase);
      }
    }
  }

  if (sessionsUrl === null || messagesUrl === null || siteKey === null) {
    return (
      <p role="status">
        Chat is not configured for this build. You can still explore the projects.
      </p>
    );
  }

  return (
    <section className="chat" aria-label="Portfolio chat">
      <p>
        Ask about the projects and technologies in this portfolio. Answers may contain mistakes.
      </p>
      <p className="chat-note">
        Messages are kept for up to 24 hours. Please avoid sharing personal information.
      </p>
      <ChatConversation
        assistantName={assistantName}
        entries={entries}
        renderLink={(link) => (
          <Link href={link.path} onNavigate={onNavigate}>
            {link.title}
          </Link>
        )}
      />
      <p role="status" aria-live="polite">
        {notice ||
          (phase === 'starting'
            ? 'Starting chat…'
            : phase === 'sending'
              ? 'Thinking…'
              : phase === 'ready'
                ? 'Chat is ready. Ask a question below.'
                : '')}
      </p>
      {phase === 'verify' && (
        <div>
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
      {(phase === 'ready' || phase === 'sending') && (
        <form onSubmit={(event) => void send(event)}>
          <label htmlFor="chat-message">Your question</label>
          <textarea
            ref={input}
            id="chat-message"
            value={message}
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            required
            rows={3}
            onChange={(event) => setMessage(event.target.value)}
            readOnly={phase === 'sending'}
          />
          <p className="chat-note">
            {message.length} / {CHAT_MESSAGE_MAX_LENGTH} characters
          </p>
          <button type="submit" disabled={phase === 'sending' || !message.trim()}>
            Send question
          </button>
        </form>
      )}
    </section>
  );
}
