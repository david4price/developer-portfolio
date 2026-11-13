/**
 * Personal content for the About and Experience pages. These are placeholders: replace them with
 * your own details. Projects live in `@portfolio/project-registry`, not here.
 */
export const profile = {
  name: 'Portfolio Owner',
  headline: 'Full stack developer',
  intro:
    "Hey, I'm a full stack developer. I like owning the whole thing: the page you're looking at, " +
    "the API behind it, and the server it runs on. This site is a good example. It's a Next.js " +
    'front end talking to a NestJS API on a small Kubernetes cluster in my home. If the status ' +
    "below says the API is online, my server's awake. Have a look around.",
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
