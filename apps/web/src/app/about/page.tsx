import type { Metadata } from 'next';
import { profile } from '@portfolio/project-registry';

export const metadata: Metadata = { title: 'About' };

export default function AboutPage() {
  const { personal } = profile;
  return (
    <>
      <h1>About</h1>
      {profile.about.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      <ul>
        {profile.links.map((link) => (
          <li key={link.href}>
            <a href={link.href}>{link.label}</a>
          </li>
        ))}
      </ul>
      {personal !== undefined && (
        // The owner's interests; a photo gallery can join this section later.
        <section aria-labelledby="personal-heading">
          <h2 id="personal-heading">Beyond the code</h2>
          <p>{personal.intro}</p>
          <ul className="grid">
            {personal.interests.map((interest) => (
              <li key={interest.name} className="ui-card">
                <h3 className="ui-card__title">{interest.name}</h3>
                <p>{interest.description}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
