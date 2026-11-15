import type { ChatLink, ChatMessageResponse } from '@portfolio/shared-types';
import type { ReactNode } from 'react';

export interface ChatEntry {
  readonly id: number;
  readonly question: string;
  readonly answer: ChatMessageResponse;
}

/** Keep existing identities when the oldest exchange leaves the bounded conversation. */
export function appendChatEntry(
  entries: readonly ChatEntry[],
  entry: ChatEntry,
): readonly ChatEntry[] {
  return [...entries.slice(-19), entry];
}

/** The first message of every chat. Written by the site, so it costs no model call. */
export function chatGreeting(assistantName: string): string {
  return `Hi, I'm ${assistantName}! I'll be your guide to this portfolio. Ask me about the projects, the technologies behind them, or where to start.`;
}

/** The assistant's face beside its messages; decorative, since the name is read out. */
function Avatar() {
  return <span className="chat-avatar" aria-hidden="true" />;
}

function Message({
  from,
  speaker,
  reply = false,
  children,
  links,
}: {
  readonly from: 'user' | 'assistant';
  readonly speaker: string;
  readonly reply?: boolean;
  readonly children: ReactNode;
  readonly links?: ReactNode;
}) {
  return (
    <div className={`chat-message chat-message--${from}`} data-reply={reply ? '' : undefined}>
      {from === 'assistant' && <Avatar />}
      <div className="chat-message__content">
        <p className="chat-bubble">
          <span className="visually-hidden">{speaker}: </span>
          {children}
        </p>
        {links}
      </div>
    </div>
  );
}

/**
 * The conversation as chat bubbles: the visitor's on the right, the assistant's on the left.
 * Speaker names are read to screen readers but not shown. `pending` is a question still waiting
 * for its answer; a typing indicator stands in for the reply until it arrives. `suggestions` are
 * starter questions offered under the greeting; choosing one sends it.
 */
export function ChatConversation({
  assistantName,
  greeting = false,
  entries,
  pending = null,
  suggestions = [],
  onSuggestion,
  renderLink,
}: {
  /** Labels the dog companion's replies. */
  readonly assistantName: string;
  /** Show the greeting first (once a chat has started). */
  readonly greeting?: boolean;
  readonly entries: readonly ChatEntry[];
  readonly pending?: string | null;
  readonly suggestions?: readonly string[];
  readonly onSuggestion?: (question: string) => void;
  readonly renderLink: (link: ChatLink) => ReactNode;
}) {
  return (
    <div
      className="chat-log"
      role="log"
      aria-label="Conversation"
      aria-live="polite"
      aria-relevant="additions"
    >
      {greeting && (
        <Message from="assistant" speaker={assistantName}>
          {chatGreeting(assistantName)}
        </Message>
      )}
      {suggestions.length > 0 && onSuggestion !== undefined && (
        <ul className="chat-suggestions" aria-label="Suggested questions">
          {suggestions.map((question) => (
            <li key={question}>
              <button type="button" onClick={() => onSuggestion(question)}>
                {question}
              </button>
            </li>
          ))}
        </ul>
      )}
      {entries.map(({ id, question, answer }) => (
        <div className="chat-exchange" key={id}>
          <Message from="user" speaker="You">
            {question}
          </Message>
          <Message
            from="assistant"
            speaker={assistantName}
            reply
            links={
              answer.links.length > 0 && (
                <ul className="chat-links" aria-label="Suggested pages">
                  {answer.links.map((link) => (
                    <li key={link.path}>{renderLink(link)}</li>
                  ))}
                </ul>
              )
            }
          >
            {answer.reply}
          </Message>
        </div>
      ))}
      {pending !== null && (
        <div className="chat-exchange">
          <Message from="user" speaker="You">
            {pending}
          </Message>
          <div className="chat-message chat-message--assistant" aria-hidden="true">
            <Avatar />
            <div className="chat-message__content">
              <p className="chat-bubble chat-typing">
                <span />
                <span />
                <span />
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
