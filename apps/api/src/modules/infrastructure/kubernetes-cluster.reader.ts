import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { readJsonBody } from '../../common/read-json-body.js';
import { type ClusterObjects, type ClusterReader, ClusterReadError } from './cluster-reader.js';
import { COMPONENT_SELECTOR } from './snapshot-serializer.js';

/** Where Kubernetes mounts the pod's service account token; it is rotated, so read it each time. */
export const SERVICE_ACCOUNT_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const listSchema = z.object({ items: z.array(z.unknown()) });

export interface KubernetesReaderOptions {
  /** `https://<host>:<port>` of the API server. Its CA comes from `NODE_EXTRA_CA_CERTS`. */
  readonly apiServerUrl: string;
  readonly namespace: string;
  /** The bearer token; reads the mounted service account token by default. */
  readonly readToken?: () => Promise<string>;
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

/**
 * Reads Deployments, StatefulSets, and Pods in one namespace from the Kubernetes API, as the
 * pod's service account. It only lists (get/list in the namespace, per the Role in P6-01) and
 * returns raw objects for the allowlist serializer; it never logs or returns response bodies.
 */
export class KubernetesClusterReader implements ClusterReader {
  private readonly baseUrl: string;
  private readonly namespacePath: string;
  private readonly readToken: () => Promise<string>;
  private readonly maxResponseBytes: number;

  constructor(options: KubernetesReaderOptions) {
    const base = new URL(options.apiServerUrl);
    const insecureAllowed = options.allowInsecureHttpForTests === true && base.protocol === 'http:';
    if (base.protocol !== 'https:' && !insecureAllowed) {
      throw new Error('The Kubernetes API server URL must use https');
    }
    this.baseUrl = base.href.replace(/\/+$/, '');
    this.namespacePath = `namespaces/${encodeURIComponent(options.namespace)}`;
    this.readToken =
      options.readToken ??
      (async () => (await readFile(SERVICE_ACCOUNT_TOKEN_PATH, 'utf8')).trim());
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  }

  async read(signal: AbortSignal): Promise<ClusterObjects> {
    const token = await this.readToken().catch(() => {
      throw new ClusterReadError('network');
    });
    // One failed list cancels the others: their replies would be thrown away anyway.
    const siblings = new AbortController();
    const combined = AbortSignal.any([signal, siblings.signal]);
    const list = (path: string) =>
      this.list(path, token, combined, signal).catch((error: unknown) => {
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

  /** `signal` aborts the request; `deadline` tells a timeout from a cancelled sibling. */
  private async list(
    path: string,
    token: string,
    signal: AbortSignal,
    deadline: AbortSignal,
  ): Promise<unknown[]> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        // A redirect would send the token somewhere other than the API server.
        redirect: 'error',
        signal,
      });
    } catch {
      throw new ClusterReadError(deadline.aborted ? 'timeout' : 'network');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ClusterReadError('status', response.status);
    }
    let body: unknown;
    try {
      body = await readJsonBody(response, this.maxResponseBytes);
    } catch {
      throw new ClusterReadError(deadline.aborted ? 'timeout' : 'network');
    }
    const parsed = listSchema.safeParse(body);
    if (!parsed.success) throw new ClusterReadError('invalid_response');
    return parsed.data.items;
  }
}
