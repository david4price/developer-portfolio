import { docNoteUrl, findDocNote } from '@portfolio/project-registry';
import type { InfrastructureComponentId } from '@portfolio/shared-types';
import {
  componentById,
  componentStatus,
  CORE_STATE_LABELS,
  coreState,
  DELIVERY_STAGES,
  type DeliveryStageId,
  formatAge,
  MAP_NODES,
  type MapPower,
  SYNC_LABELS,
} from './map-model.ts';

/** Everything on the map that opens a card: components, delivery stages, and the cluster. */
export type CardId = InfrastructureComponentId | DeliveryStageId | 'cluster';

interface CardCopy {
  readonly about: string;
  /** Slug of the architecture note the card links to for more. */
  readonly note: string;
}

/** What each part is and why it's there; kept short, with the full story in the linked note. */
const COPY: Readonly<Record<CardId, CardCopy>> = {
  web: {
    about:
      'The site you are on: a static Next.js export served from Cloudflare’s network, with no ' +
      'server of its own, so it stays up when the home server is down.',
    note: 'static-site',
  },
  tunnel: {
    about:
      'A Cloudflare Tunnel: a pod in the cluster connects out to Cloudflare, so the home router ' +
      'opens no inbound ports. Only /api/v1 is routed.',
    note: 'networking',
  },
  api: {
    about:
      'The NestJS REST API on Fastify, one modular monolith under /api/v1. It scales between 1 ' +
      'and 3 pods on CPU load.',
    note: 'rest-api',
  },
  worker: {
    about: 'A BullMQ worker that runs background jobs from the Redis queues, beside the API.',
    note: 'architecture-overview',
  },
  ai: {
    about:
      'A small open-weight model on the home server’s GPU, behind the API’s provider interface. ' +
      'Only the chat assistant uses it; everything else works without it.',
    note: 'chat-assistant',
  },
  postgres: {
    about:
      'PostgreSQL holds the portfolio’s data. A nightly job dumps it, checks each dump, and keeps ' +
      '7 daily and 4 weekly copies.',
    note: 'backups',
  },
  redis: {
    about: 'Redis holds chat sessions, rate limits, and the job queues.',
    note: 'architecture-overview',
  },
  argocd: {
    about:
      'Argo CD syncs the cluster from Git: the Helm chart plus the image digests pinned in ' +
      'images.yaml. It is not public.',
    note: 'gitops-release',
  },
  actions: {
    about:
      'GitHub Actions lints, tests, and builds every change. After a merge to main, a release ' +
      'workflow builds the API and worker images.',
    note: 'testing',
  },
  ghcr: {
    about:
      'GitHub Container Registry stores the API and worker images, which the cluster pulls by digest.',
    note: 'gitops-release',
  },
  pin: {
    about:
      'The release workflow commits the new image digests to images.yaml; that commit is what ' +
      'Argo CD deploys, and reverting it rolls back.',
    note: 'gitops-release',
  },
  cluster: {
    about:
      'Single-node K3s on a home server, from a Helm chart in this repository. Every pod runs as ' +
      'non-root with a read-only filesystem, and network policies allow only the paths each part needs.',
    note: 'kubernetes',
  },
};

export interface CardDetails {
  readonly title: string;
  readonly subtitle: string;
  readonly about: string;
  /** The architecture note to read more in, on GitHub; `null` if the note no longer exists. */
  readonly more: { readonly title: string; readonly url: string } | null;
  /** Live facts from the snapshot, as label and value; empty when there is no data. */
  readonly facts: readonly (readonly [string, string])[];
  /** Why there are no facts, when there are none. */
  readonly noFacts: string | null;
}

function titleOf(id: CardId): { title: string; subtitle: string } {
  if (id === 'cluster') return { title: 'K3s cluster', subtitle: 'Flux capacitor' };
  const node = MAP_NODES.find((candidate) => candidate.id === id);
  if (node !== undefined) return { title: node.label, subtitle: node.detail };
  const stage = DELIVERY_STAGES.find((candidate) => candidate.id === id);
  return { title: stage?.label ?? id, subtitle: 'Delivery' };
}

/** The live facts for a card: only allowlisted snapshot fields, never anything else. */
function facts(id: CardId, power: MapPower, now: number): CardDetails['facts'] {
  if (!power.on) return [];
  const { snapshot } = power;
  const updated: readonly [string, string] = ['Updated', formatAge(snapshot.generatedAt, now)];
  if (id === 'cluster') {
    return [
      ['State', CORE_STATE_LABELS[coreState(snapshot)]],
      ['GitOps', SYNC_LABELS[snapshot.sync]],
      ['Release', snapshot.release?.commit ?? '—'],
      updated,
    ];
  }
  if (id === 'pin' || id === 'ghcr' || id === 'actions') {
    if (id !== 'pin' || snapshot.release === null) return [];
    return [
      ['Release', snapshot.release.commit],
      ['Pinned', formatAge(snapshot.release.pinnedAt, now)],
      updated,
    ];
  }
  const component = componentById(snapshot, id);
  const replicas = component.replicas;
  return [
    ['Status', componentStatus(component)],
    ['Version', component.version ?? '—'],
    [
      'Replicas',
      replicas === null
        ? '—'
        : `${replicas.ready} ready, ${replicas.available} available, ${replicas.desired} desired`,
    ],
    ['Traffic', component.traffic ?? 'not measured yet'],
    updated,
  ];
}

export function cardDetails(id: CardId, power: MapPower, now: number): CardDetails {
  const copy = COPY[id];
  const note = findDocNote(copy.note);
  const live = facts(id, power, now);
  return {
    ...titleOf(id),
    about: copy.about,
    more: note === undefined ? null : { title: note.title, url: docNoteUrl(note) },
    facts: live,
    noFacts:
      live.length > 0
        ? null
        : !power.on
          ? 'Live status unavailable.'
          : 'No live data for this stage yet.',
  };
}

/** Every card id, for tests and for checking that each has copy. */
export const CARD_IDS: readonly CardId[] = [
  ...MAP_NODES.map(({ id }) => id),
  ...DELIVERY_STAGES.map(({ id }) => id),
  'cluster',
];
