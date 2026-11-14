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

export function ChatConversation({
  entries,
  renderLink,
}: {
  readonly entries: readonly ChatEntry[];
  readonly renderLink: (link: ChatLink) => ReactNode;
}) {
  return (
    <div role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
      {entries.map(({ id, question, answer }) => (
        <article className="chat-entry" key={id}>
          <h2 className="chat-speaker">You</h2>
          <p className="chat-text">{question}</p>
          <h2 className="chat-speaker">Portfolio assistant</h2>
          <p className="chat-text">{answer.reply}</p>
          {answer.links.length > 0 && (
            <ul aria-label="Suggested pages">
              {answer.links.map((link) => (
                <li key={link.path}>{renderLink(link)}</li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  );
}
