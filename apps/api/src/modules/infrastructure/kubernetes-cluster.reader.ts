import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { readJsonBody } from '../../common/read-json-body.js';
import { type ClusterObjects, type ClusterReader, ClusterReadError } from './cluster-reader.js';

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
}

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
    if (base.protocol !== 'https:' && base.protocol !== 'http:') {
      throw new Error('The Kubernetes API server URL must use http(s)');
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
    const [deployments, statefulSets, pods] = await Promise.all([
      this.list(`/apis/apps/v1/${this.namespacePath}/deployments`, token, signal),
      this.list(`/apis/apps/v1/${this.namespacePath}/statefulsets`, token, signal),
      this.list(`/api/v1/${this.namespacePath}/pods`, token, signal),
    ]);
    return { deployments, statefulSets, pods };
  }

  private async list(path: string, token: string, signal: AbortSignal): Promise<unknown[]> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        // A redirect would send the token somewhere other than the API server.
        redirect: 'error',
        signal,
      });
    } catch {
      throw new ClusterReadError(signal.aborted ? 'timeout' : 'network');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ClusterReadError('status', response.status);
    }
    let body: unknown;
    try {
      body = await readJsonBody(response, this.maxResponseBytes);
    } catch {
      throw new ClusterReadError(signal.aborted ? 'timeout' : 'network');
    }
    const parsed = listSchema.safeParse(body);
    if (!parsed.success) throw new ClusterReadError('invalid_response');
    return parsed.data.items;
  }
}
