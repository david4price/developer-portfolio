import type { Metadata } from 'next';
import { profile } from '@portfolio/project-registry';
import { InterestCard } from '@/components/interest-card';

export const metadata: Metadata = { title: 'About' };

export default function AboutPage() {
  const { personal } = profile;
  return (
    <>
      <h1>About</h1>
      {profile.about.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {personal !== undefined && (
        <section aria-labelledby="personal-heading">
          <h2 id="personal-heading">Beyond the code</h2>
          <p>{personal.intro}</p>
          {/* Photos sit behind the cards they belong to (prints peek out; the card opens them). */}
          <ul className="grid interest-grid">
            {personal.interests.map((interest) => (
              <InterestCard
                key={interest.name}
                name={interest.name}
                description={interest.description}
                photos={interest.photos}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
