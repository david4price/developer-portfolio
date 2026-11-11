import { findMiniApp, miniAppRouteParams } from '@portfolio/project-registry';
import { StatusBadge } from '@portfolio/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

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
 * Shell for integrated mini-apps. Available apps will mount a client component loaded with
 * `next/dynamic`, so each app's code ships only on its own route.
 */
export default async function MiniAppPage({ params }: MiniAppPageProps) {
  const app = findMiniApp((await params).slug);
  if (app === undefined) notFound();

  return (
    <article>
      <h1>{app.title}</h1>
      <p className="lead">{app.summary}</p>
      {app.status === 'planned' && <StatusBadge tone="neutral" label="Planned — not built yet" />}
    </article>
  );
}
