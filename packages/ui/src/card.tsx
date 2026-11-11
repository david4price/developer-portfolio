import type { ReactNode } from 'react';

export interface CardProps {
  readonly title: ReactNode;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  /** Heading level for the title, so cards fit the surrounding document outline. */
  readonly headingLevel?: 2 | 3;
}

export function Card({ title, children, footer, headingLevel = 2 }: CardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article className="ui-card">
      <Heading className="ui-card__title">{title}</Heading>
      {children !== undefined && <div className="ui-card__body">{children}</div>}
      {footer !== undefined && <footer className="ui-card__footer">{footer}</footer>}
    </article>
  );
}
