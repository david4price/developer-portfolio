import { findMiniApp, miniAppRouteParams } from '@portfolio/project-registry';
import { StatusBadge } from '@portfolio/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { InfrastructureExplorerLoader } from '../../../mini-apps/infrastructure-explorer/loader';

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

function plannedLabel(slug: string): string {
  if (slug === 'portfolio-assistant') return 'Preview — production setup pending';
  if (slug === 'infrastructure-explorer') return 'Prototype — sample data, not live';
  return 'Planned — not built yet';
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
      {app.status === 'planned' && <StatusBadge tone="neutral" label={plannedLabel(app.slug)} />}
      {app.slug === 'infrastructure-explorer' && <InfrastructureExplorerLoader />}
      {app.slug === 'portfolio-assistant' && (
        <p>
          Open the chat button in the bottom-right corner to ask about the portfolio from any page.
        </p>
      )}
    </article>
  );
}
