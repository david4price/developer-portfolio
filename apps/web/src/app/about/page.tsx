import type { Metadata } from 'next';
import { profile } from '@/content/profile';

export const metadata: Metadata = { title: 'About' };

export default function AboutPage() {
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
    </>
  );
}
