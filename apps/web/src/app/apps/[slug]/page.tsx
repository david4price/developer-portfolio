import { findMiniApp, miniAppRouteParams } from '@portfolio/project-registry';
import { StatusBadge } from '@portfolio/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { miniAppViews } from '../../../mini-apps';

interface MiniAppPageProps {
  readonly params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return miniAppRouteParams();
}

export async function generateMetadata({ params }: MiniAppPageProps): Promise<Metadata> {
  const app = findMiniApp((await params).slug);
  return app === undefined ? {} : { title: app.title, description: app.summary };
}

/**
 * Shell for integrated mini-apps: the view registered for the slug in `mini-apps/index.ts` (a
 * `next/dynamic` loader for real apps, so their code ships only on their own route); planned ones
 * also show a badge. Status comes from the registry, not from this page.
 */
export default async function MiniAppPage({ params }: MiniAppPageProps) {
  const app = findMiniApp((await params).slug);
  if (app === undefined) notFound();
  const View = miniAppViews[app.slug];

  return (
    <article>
      <h1>{app.title}</h1>
      <p className="lead">{app.summary}</p>
      {app.status === 'planned' && <StatusBadge tone="neutral" label="Planned — not built yet" />}
      {View !== undefined && <View />}
    </article>
  );
}
