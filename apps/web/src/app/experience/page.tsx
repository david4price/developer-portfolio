import type { Metadata } from 'next';
import { experienceKey, profile } from '@portfolio/project-registry';

export const metadata: Metadata = { title: 'Experience' };

export default function ExperiencePage() {
  return (
    <>
      <h1>Experience</h1>
      {/* A timeline: when on the left, the role on the right, joined by a hairline. */}
      <ol className="timeline">
        {profile.experience.map((entry) => (
          <li key={experienceKey(entry)} className="timeline__entry">
            <p className="timeline__period">{entry.period}</p>
            <div className="timeline__body">
              <h2 className="timeline__role">{entry.role}</h2>
              <p className="timeline__organization">{entry.organization}</p>
              <ul className="timeline__highlights">
                {entry.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
