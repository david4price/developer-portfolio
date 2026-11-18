/**
 * Reads a response body of at most `maxBytes` and parses it as JSON. Returns `undefined` for a
 * missing, oversized, or malformed body, so each adapter maps that to its own typed error.
 * Leaving early cancels the stream and releases the connection.
 */
export async function readJsonBody(response: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    return undefined;
  }
  if (response.body === null) return undefined;

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
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
