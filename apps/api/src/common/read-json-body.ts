/**
 * Reads a JSON body of at most `maxBytes` from a byte stream. Returns `undefined` for an
 * oversized or malformed body, so each adapter maps that to its own typed error. Leaving the loop
 * early (too large) ends the iteration, which releases the stream.
 */
export async function readJsonStream(
  stream: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > maxBytes) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/** True when a declared `Content-Length` already exceeds the limit (no need to read the body). */
export function declaredTooLarge(contentLength: string | null | undefined, maxBytes: number) {
  const declared = Number(contentLength);
  return contentLength != null && Number.isFinite(declared) && declared > maxBytes;
}

/**
 * Reads a fetch `Response` body of at most `maxBytes` and parses it as JSON; `undefined` for a
 * missing, oversized, or malformed body.
 */
export async function readJsonBody(response: Response, maxBytes: number): Promise<unknown> {
  if (declaredTooLarge(response.headers.get('content-length'), maxBytes)) {
    await response.body?.cancel();
    return undefined;
  }
  if (response.body === null) return undefined;
  return readJsonStream(response.body, maxBytes);
}
