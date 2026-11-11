import type { Metadata } from 'next';
import { experience } from '@/content/profile';

export const metadata: Metadata = { title: 'Experience' };

export default function ExperiencePage() {
  return (
    <>
      <h1>Experience</h1>
      <ol className="grid">
        {experience.map((entry) => (
          <li key={`${entry.organization}-${entry.period}`} className="ui-card">
            <h2 className="ui-card__title">
              {entry.role} · {entry.organization}
            </h2>
            <p>{entry.period}</p>
            <ul>
              {entry.highlights.map((highlight) => (
                <li key={highlight}>{highlight}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </>
  );
}
