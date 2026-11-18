import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { z } from 'zod';
import { type ClusterObjects, type ClusterReader, ClusterReadError } from './cluster-reader.js';
import { COMPONENT_SELECTOR } from './snapshot-serializer.js';

/**
 * Where Kubernetes mounts the pod's service account: the token (rotated, so read on every call)
 * and the cluster CA. The reader trusts that CA for its own requests only, never process-wide.
 */
export const SERVICE_ACCOUNT_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const listSchema = z.object({ items: z.array(z.unknown()) });

export interface KubernetesReaderOptions {
  /** `https://<host>:<port>` of the API server. */
  readonly apiServerUrl: string;
  readonly namespace: string;
  /** The bearer token; reads the mounted service account token by default. */
  readonly readToken?: () => Promise<string>;
  /** The API server's CA (PEM); reads the mounted cluster CA by default. */
  readonly readCa?: () => Promise<string | undefined>;
  /** Upper bound on each list response; larger replies are treated as malformed. */
  readonly maxResponseBytes?: number;
  /**
   * Allow a plain-http URL. Only for tests against a local fake server: the reader always sends
   * the service account token, which must never travel unencrypted.
   */
  readonly allowInsecureHttpForTests?: boolean;
}

/** Only the components the snapshot shows (Job and backup pods stay out of the reply). */
const LABEL_SELECTOR = `labelSelector=${encodeURIComponent(COMPONENT_SELECTOR)}`;
/** Finished pods (evicted, completed) are filtered on the server, not after the download. */
const LIVE_PODS = `fieldSelector=${encodeURIComponent('status.phase!=Failed,status.phase!=Succeeded')}`;

const fromServiceAccount = (file: string) => () =>
  readFile(`${SERVICE_ACCOUNT_DIR}/${file}`, 'utf8');

interface RequestContext {
  readonly token: string;
  readonly ca: string | undefined;
  /** Aborts the request: the read's deadline, or a failed sibling. */
  readonly signal: AbortSignal;
  /** The read's own deadline, to tell a timeout from a cancelled sibling. */
  readonly deadline: AbortSignal;
}

/**
 * Reads Deployments, StatefulSets, and Pods in one namespace from the Kubernetes API, as the
 * pod's service account. It only lists (get/list in the namespace, per the Role in P6-01) and
 * returns raw objects for the allowlist serializer; it never logs or returns response bodies.
 * Requests don't follow redirects, so the token only ever goes to the configured server.
 */
export class KubernetesClusterReader implements ClusterReader {
  private readonly baseUrl: string;
  private readonly namespacePath: string;
  private readonly readToken: () => Promise<string>;
  private readonly readCa: () => Promise<string | undefined>;
  private readonly maxResponseBytes: number;

  constructor(options: KubernetesReaderOptions) {
    const base = new URL(options.apiServerUrl);
    const insecureAllowed = options.allowInsecureHttpForTests === true && base.protocol === 'http:';
    if (base.protocol !== 'https:' && !insecureAllowed) {
      throw new Error('The Kubernetes API server URL must use https');
    }
    this.baseUrl = base.href.replace(/\/+$/, '');
    this.namespacePath = `namespaces/${encodeURIComponent(options.namespace)}`;
    this.readToken = options.readToken ?? fromServiceAccount('token');
    this.readCa = options.readCa ?? fromServiceAccount('ca.crt');
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  }

  async read(signal: AbortSignal): Promise<ClusterObjects> {
    let token: string;
    let ca: string | undefined;
    try {
      [token, ca] = await Promise.all([
        this.readToken().then((value) => value.trim()),
        this.baseUrl.startsWith('https:') ? this.readCa() : Promise.resolve(undefined),
      ]);
    } catch {
      throw new ClusterReadError('network');
    }
    // One failed list cancels the others: their replies would be thrown away anyway.
    const siblings = new AbortController();
    const context = (): RequestContext => ({
      token,
      ca,
      signal: AbortSignal.any([signal, siblings.signal]),
      deadline: signal,
    });
    const list = (path: string) =>
      this.list(path, context()).catch((error: unknown) => {
        siblings.abort();
        throw error;
      });
    const [deployments, statefulSets, pods] = await Promise.all([
      list(`/apis/apps/v1/${this.namespacePath}/deployments?${LABEL_SELECTOR}`),
      list(`/apis/apps/v1/${this.namespacePath}/statefulsets?${LABEL_SELECTOR}`),
      list(`/api/v1/${this.namespacePath}/pods?${LABEL_SELECTOR}&${LIVE_PODS}`),
    ]);
    return { deployments, statefulSets, pods };
  }

  private async list(path: string, context: RequestContext): Promise<unknown[]> {
    const parsed = listSchema.safeParse(
      await this.getJson(new URL(`${this.baseUrl}${path}`), context),
    );
    if (!parsed.success) throw new ClusterReadError('invalid_response');
    return parsed.data.items;
  }

  /** GET with the token and (for https) the cluster CA; at most `maxResponseBytes` of JSON. */
  private getJson(url: URL, { token, ca, signal, deadline }: RequestContext): Promise<unknown> {
    const failure = () => new ClusterReadError(deadline.aborted ? 'timeout' : 'network');
    const tooLarge = () => new ClusterReadError('invalid_response');
    return new Promise((resolve, reject) => {
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const request = send(
        url,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
          signal,
          ...(ca === undefined ? {} : { ca }),
        },
        (response) => {
          // Anything but 200 (redirects included, which are never followed) is a failure.
          if (response.statusCode !== 200) {
            response.resume();
            reject(new ClusterReadError('status', response.statusCode ?? null));
            return;
          }
          const declared = Number(response.headers['content-length']);
          if (Number.isFinite(declared) && declared > this.maxResponseBytes) {
            request.destroy();
            reject(tooLarge());
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          response.on('data', (chunk: Buffer) => {
            total += chunk.byteLength;
            if (total > this.maxResponseBytes) {
              request.destroy();
              reject(tooLarge());
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
            } catch {
              reject(new ClusterReadError('invalid_response'));
            }
          });
          response.on('error', () => reject(failure()));
        },
      );
      request.on('error', () => reject(failure()));
      request.end();
    });
  }
}
