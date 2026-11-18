import { readFile } from 'node:fs/promises';
import { type IncomingMessage, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { z } from 'zod';
import { declaredTooLarge, readJsonStream } from '../../common/read-json-body.js';
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
  readonly readCa?: () => Promise<string>;
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
  /** For https: a connection pool that trusts the cluster CA (and nothing else). */
  readonly agent: HttpsAgent | undefined;
  /** Aborts the requests: the read's deadline, or a failed sibling. */
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
  private readonly https: boolean;
  private readonly namespacePath: string;
  private readonly readToken: () => Promise<string>;
  private readonly readCa: () => Promise<string>;
  private readonly maxResponseBytes: number;
  /** The pool for the current CA; rebuilt only when the mounted CA changes. */
  private pool: { readonly ca: string; readonly agent: HttpsAgent } | null = null;

  constructor(options: KubernetesReaderOptions) {
    const base = new URL(options.apiServerUrl);
    const insecureAllowed = options.allowInsecureHttpForTests === true && base.protocol === 'http:';
    if (base.protocol !== 'https:' && !insecureAllowed) {
      throw new Error('The Kubernetes API server URL must use https');
    }
    this.baseUrl = base.href.replace(/\/+$/, '');
    this.https = base.protocol === 'https:';
    this.namespacePath = `namespaces/${encodeURIComponent(options.namespace)}`;
    this.readToken = options.readToken ?? fromServiceAccount('token');
    this.readCa = options.readCa ?? fromServiceAccount('ca.crt');
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  }

  async read(signal: AbortSignal): Promise<ClusterObjects> {
    let token: string;
    let agent: HttpsAgent | undefined;
    try {
      token = (await this.readToken()).trim();
      agent = this.https ? this.agentFor(await this.readCa()) : undefined;
    } catch {
      throw new ClusterReadError('credentials');
    }
    // One failed list cancels the others: their replies would be thrown away anyway.
    const siblings = new AbortController();
    const context: RequestContext = {
      token,
      agent,
      signal: AbortSignal.any([signal, siblings.signal]),
      deadline: signal,
    };
    const list = (path: string) =>
      this.list(path, context).catch((error: unknown) => {
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

  private agentFor(ca: string): HttpsAgent {
    if (this.pool?.ca !== ca) {
      this.pool?.agent.destroy();
      this.pool = { ca, agent: new HttpsAgent({ ca, keepAlive: true }) };
    }
    return this.pool.agent;
  }

  private async list(path: string, context: RequestContext): Promise<unknown[]> {
    const response = await this.get(new URL(`${this.baseUrl}${path}`), context);
    let body: unknown;
    try {
      body = declaredTooLarge(response.headers['content-length'], this.maxResponseBytes)
        ? undefined
        : await readJsonStream(response, this.maxResponseBytes);
    } catch {
      throw new ClusterReadError(context.deadline.aborted ? 'timeout' : 'network');
    } finally {
      // Releases the connection if the body was refused or only partly read.
      if (!response.complete) response.destroy();
    }
    const parsed = listSchema.safeParse(body);
    if (!parsed.success) throw new ClusterReadError('invalid_response');
    return parsed.data.items;
  }

  /** Resolves with a 200 response; anything else (redirects too, never followed) rejects. */
  private get(
    url: URL,
    { token, agent, signal, deadline }: RequestContext,
  ): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      const send = this.https ? httpsRequest : httpRequest;
      const request = send(
        url,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
          signal,
          ...(agent === undefined ? {} : { agent }),
        },
        (response) => {
          if (response.statusCode === 200) {
            resolve(response);
            return;
          }
          // Close at once rather than downloading an error body nobody reads.
          request.destroy();
          reject(new ClusterReadError('status', response.statusCode ?? null));
        },
      );
      request.on('error', () =>
        reject(new ClusterReadError(deadline.aborted ? 'timeout' : 'network')),
      );
      request.end();
    });
  }
}
