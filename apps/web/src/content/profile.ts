/**
 * Personal content for the About and Experience pages. These are placeholders: replace them with
 * your own details. Projects live in `@portfolio/project-registry`, not here.
 */
export const profile = {
  name: 'Portfolio Owner',
  headline: 'Full-stack and platform engineer',
  intro:
    'I build TypeScript applications end to end — from React interfaces to NestJS services — and ' +
    'run them on infrastructure I can explain, measure, and reproduce.',
  about: [
    'Replace this paragraph with a short professional summary: what you build, the problems you ' +
      'like solving, and how you work.',
    'Replace this paragraph with the engineering practices you care about, such as testing, ' +
      'observability, security, and documentation.',
  ],
  links: [{ label: 'GitHub', href: 'https://github.com/david4price' }],
} as const;

export interface ExperienceEntry {
  readonly role: string;
  readonly organization: string;
  readonly period: string;
  readonly highlights: readonly string[];
}

export const experience: readonly ExperienceEntry[] = [
  {
    role: 'Role title',
    organization: 'Organization',
    period: 'Start – End',
    highlights: [
      'Replace with a measurable outcome you delivered.',
      'Replace with a system you designed, built, or operated.',
    ],
  },
];
