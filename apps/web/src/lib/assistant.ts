import { ASSISTANT_NAME_PATTERN, DEFAULT_ASSISTANT_NAME } from '@portfolio/shared-types';

/**
 * The name shown for the chat's dog companion. Unset or empty means the default; anything that
 * isn't a plain name fails the build instead of showing a name the API would reject.
 */
export function assistantNameFrom(value: string | undefined): string {
  const name = value?.trim() ?? '';
  if (name === '') return DEFAULT_ASSISTANT_NAME;
  if (!ASSISTANT_NAME_PATTERN.test(name)) {
    throw new Error(
      'NEXT_PUBLIC_ASSISTANT_NAME must be 1-30 letters, spaces, hyphens, or apostrophes',
    );
  }
  return name;
}

/** Inlined at build time; set it to the same value as the API's `CHAT_ASSISTANT_NAME`. */
export const assistantName = assistantNameFrom(process.env.NEXT_PUBLIC_ASSISTANT_NAME);
