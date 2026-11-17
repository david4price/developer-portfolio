import { docNoteUrl, findDocNote, findMiniApp, findProject } from '@portfolio/project-registry';
import type {
  ChatLink,
  ChatMessageRequest,
  ChatMessageResponse,
  ChatSessionRequest,
  ChatSessionResponse,
} from '@portfolio/shared-types';

const messages: Readonly<Record<string, string>> = {
  ai_disabled: 'Chat is currently unavailable. You can still explore the projects.',
  ai_overloaded: 'Chat is busy. Please try again shortly.',
  chat_busy: 'Another reply is still being prepared. Please wait and try again.',
  chat_session_required: 'Your session has expired or cookies are blocked. Start a new chat.',
  challenge_failed: 'Verification was not accepted. Please complete a fresh check.',
  challenge_unavailable: 'Verification is unavailable. Please try again shortly.',
  message_rejected: 'Please ask a question about the portfolio or its projects.',
  rate_limited: 'You have reached the chat limit. Please try again later.',
};

export class ChatRequestError extends Error {
  constructor(readonly code: string) {
    super(messages[code] ?? 'Chat is unavailable. Please try again shortly.');
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Cookie credentials are limited to chat calls; neither tokens nor history are persisted. */
async function post(url: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const code = record(data) && record(data.error) ? data.error.code : undefined;
      throw new ChatRequestError(typeof code === 'string' ? code : 'unavailable');
    }
    return data;
  } catch (error) {
    if (error instanceof ChatRequestError) throw error;
    throw new ChatRequestError('unavailable');
  }
}

export async function createChatSession(
  url: string,
  token: string,
  signal: AbortSignal,
): Promise<ChatSessionResponse> {
  const body: ChatSessionRequest = { turnstileToken: token };
  const data = await post(url, body, signal);
  if (
    !record(data) ||
    typeof data.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(data.expiresAt))
  ) {
    throw new ChatRequestError('unavailable');
  }
  return { expiresAt: data.expiresAt };
}

/** Resolve against this build's registry, never a model-supplied URL or link label. */
function navigationLink(value: unknown): ChatLink | null {
  if (!record(value) || typeof value.slug !== 'string') return null;
  if (value.kind === 'doc') {
    // The URL comes from this build alone, so an API released with other repository settings
    // still links the note's source as this site knows it.
    const note = findDocNote(value.slug);
    return note === undefined
      ? null
      : { kind: 'doc', slug: note.slug, title: note.title, path: docNoteUrl(note) };
  }
  if (value.kind !== 'project' && value.kind !== 'mini-app') return null;
  const entry = value.kind === 'project' ? findProject(value.slug) : findMiniApp(value.slug);
  if (entry === undefined) return null;
  const path = `/${value.kind === 'project' ? 'projects' : 'apps'}/${entry.slug}/`;
  if (value.path !== path) return null;
  return { kind: value.kind, slug: entry.slug, title: entry.title, path };
}

export async function sendChatMessage(
  url: string,
  message: string,
  signal: AbortSignal,
): Promise<ChatMessageResponse> {
  const body: ChatMessageRequest = { message };
  const data = await post(url, body, signal);
  if (!record(data) || typeof data.reply !== 'string' || !Array.isArray(data.links)) {
    throw new ChatRequestError('unavailable');
  }
  const links = new Map<string, ChatLink>();
  for (const value of data.links as unknown[]) {
    const link = navigationLink(value);
    if (link !== null && !links.has(`${link.kind}:${link.slug}`)) {
      links.set(`${link.kind}:${link.slug}`, link);
    }
  }
  return { reply: data.reply, links: [...links.values()].slice(0, 3) };
}
