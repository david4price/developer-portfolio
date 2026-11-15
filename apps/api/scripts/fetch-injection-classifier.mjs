#!/usr/bin/env node
// Downloads the chat's injection classifier (P5-08) into a directory, pinned by revision and
// verified by SHA-256: a file that doesn't match is never installed. Files already present with
// the right hash are kept, so repeated runs download nothing.
//
// Usage: node apps/api/scripts/fetch-injection-classifier.mjs <directory>
//
// Model: Wolf Defender Small v2.1 (Patronus Studio), Apache-2.0, an mmBERT-small (ModernBERT)
// binary classifier: BENIGN / INJECTION; the int8-weight, int4-embedding ONNX export, run with
// onnxruntime-node on the CPU. ONNX files are data (a graph and weights), not code.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REPOSITORY = 'patronus-studio/wolf-defender-prompt-injection-small';
const REVISION = '2484cc9a13550aa4f2c29b577ff3ef331dc6ba07';
const FILES = [
  {
    source: 'onnx/int8_int4_embeddings/model.onnx',
    target: 'model.onnx',
    bytes: 96_296_126,
    sha256: 'd0c48821809f9eded1e4a8902c8698f095cf5ba4ac84bb2d310befc651bc16b5',
  },
  {
    source: 'config.json',
    target: 'config.json',
    bytes: 2_065,
    sha256: '8717a09329fd5f7e8477b6fd6b32b553a89f8421d47b4f9b108f42a59389d0f8',
  },
  {
    source: 'tokenizer.json',
    target: 'tokenizer.json',
    bytes: 34_363_188,
    sha256: '609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f',
  },
  {
    source: 'tokenizer_config.json',
    target: 'tokenizer_config.json',
    bytes: 574,
    sha256: '14b147f2a4f939d9b12ab36e9633917040dd948fa78ce283b03402e4cf2c9cba',
  },
  {
    source: 'LICENSE',
    target: 'LICENSE',
    bytes: 11_358,
    sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
  },
];

const directory = process.argv[2];
if (!directory) {
  console.error('usage: fetch-injection-classifier.mjs <directory>');
  process.exit(2);
}

async function sha256Of(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function present(path, { bytes, sha256 }) {
  try {
    return (await stat(path)).size === bytes && (await sha256Of(path)) === sha256;
  } catch {
    return false;
  }
}

await mkdir(directory, { recursive: true });
for (const file of FILES) {
  const path = join(directory, file.target);
  if (await present(path, file)) {
    console.log(`kept ${file.target}`);
    continue;
  }
  const url = `https://huggingface.co/${REPOSITORY}/resolve/${REVISION}/${file.source}`;
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(600_000) });
  if (!response.ok || response.body === null) {
    throw new Error(`${file.source}: HTTP ${response.status}`);
  }
  const partial = `${path}.partial`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    if (!(await present(partial, file)))
      throw new Error(`${file.source}: size or SHA-256 mismatch`);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  await rename(partial, path);
  console.log(`fetched ${file.target} (${file.bytes} bytes)`);
}
