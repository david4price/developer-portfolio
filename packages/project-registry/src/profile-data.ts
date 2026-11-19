import type { ProfileInput } from './schema.js';

/**
 * The owner's profile for the home page, About, and Experience (P2-12). Validated at import
 * time, like the registry; keep it free of private details: it is public, and the chat assistant
 * may index it.
 */
export const profileData: ProfileInput = {
  name: 'David Praise',
  headline: 'Backend Developer | Full-Stack Development, APIs & Automation',
  intro:
    "Hey, I'm David. I'm a backend developer who likes owning the whole thing: the page you're " +
    'looking at, the API behind it, and how it all runs. I work in aviation software, building ' +
    'APIs, integrations, and solutions to real operational problems. I enjoy figuring out how ' +
    "things work, making them better, and learning new technologies along the way. Whether it's " +
    'a small feature or an entire application, I like building things that are useful, ' +
    'reliable, and easy to maintain.',
  about: [
    "I'm a software developer with a background in technical support and a strong focus on " +
      'backend engineering. I started out investigating complex software issues, working with ' +
      'databases, APIs, and existing applications. That experience taught me to look beyond the ' +
      'code and understand how systems actually behave, how people use them, and what happens ' +
      'when something goes wrong. Eventually, I moved into development, where I could start ' +
      'building the solutions myself.',
    'My experience includes JavaScript, TypeScript, Node.js, NestJS, SQL, PHP, and Classic ' +
      "ASP, along with Redis, Docker, and AWS. I'm also familiar with Python and its web " +
      'frameworks Django and Flask, and have experience with React. I enjoy working across the ' +
      'stack, particularly on API design, integrations, background processing, automation, and ' +
      "applications that bring different technologies together. I'm more interested in choosing " +
      'the right tool for the job than sticking to one language or framework.',
    'I care about writing maintainable code, understanding the reasoning behind technical ' +
      'decisions, and making systems reliable. That means investigating edge cases, testing ' +
      'changes, thinking about security, documenting important decisions, and considering how ' +
      'software behaves in production. I also enjoy working with CI/CD, containers, and ' +
      "deployment workflows. I'm constantly exploring better tools and approaches, including " +
      'AI-assisted development, where I use prompting, structured instructions, and coding ' +
      'agents to improve my workflow.',
    'Outside of work, I enjoy building personal projects and experimenting with new ' +
      "technologies. I'm naturally curious and tend to learn best by building something and " +
      "figuring things out as I go. When I'm away from the keyboard, you'll probably find me " +
      'mountain biking, surfing, taking photos, or playing guitar. I like having a good mix of ' +
      'technical challenges, creativity, and outdoor adventures.',
  ],
  links: [{ label: 'GitHub', href: 'https://github.com/david4price' }],
  experience: [
    {
      role: 'Backend Developer',
      organization: 'GO7 (formerly AeroCRS)',
      period: 'Jan 2025 – Present',
      highlights: [
        'Developed and maintained backend services and REST APIs using Node.js, NestJS, ' +
          'JavaScript, TypeScript, and SQL.',
        'Built backend workflows using SQL Server, TypeORM, Redis, and background job queues ' +
          'to support operational processes.',
        'Worked on software solutions for aviation operations, including reservation-related ' +
          'processes, integrations, and data handling.',
        'Investigated and resolved application issues across backend services, databases, ' +
          'APIs, and existing systems.',
        'Worked with PHP and Classic ASP applications, maintaining existing functionality and ' +
          'implementing improvements alongside newer technologies.',
        'Used Docker and related development tools to support application development, ' +
          'testing, and deployment workflows.',
        'Reviewed code, analyzed database queries, and collaborated with other teams to ' +
          'troubleshoot issues and improve application reliability.',
        'Applied AI-assisted development techniques, including structured prompting and ' +
          'coding agents, to support coding, debugging, and technical research.',
      ],
    },
    {
      role: 'Technical Support Specialist',
      organization: 'GO7 (formerly AeroCRS)',
      period: '2022 – Jan 2025',
      highlights: [
        'Investigated complex technical issues across aviation reservation systems, websites, ' +
          'APIs, and third-party integrations.',
        'Analyzed SQL queries, application behavior, and database records to identify root ' +
          'causes and support issue resolution.',
        'Reproduced software bugs, documented findings, and worked with developers to ' +
          'identify and validate fixes.',
        'Troubleshot API requests, integration failures, and unexpected system behavior ' +
          'across interconnected applications.',
        'Worked with Zendesk, Jira, and HubSpot to manage technical issues, communicate ' +
          'findings, and coordinate with relevant teams.',
        'Developed a strong understanding of software architecture, database relationships, ' +
          'and production troubleshooting, building the foundation for my transition into ' +
          'software development.',
      ],
    },
  ],
};
