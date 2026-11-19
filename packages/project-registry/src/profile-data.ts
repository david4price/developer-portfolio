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
    "I think there's more to being a developer than sitting behind a screen. A lot of what I " +
      'enjoy outside of work comes down to the same things: curiosity, learning, and ' +
      "challenging myself. Here's a little more about what keeps me busy when I'm not writing " +
      'code.',
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
  personal: {
    intro:
      "I'm the kind of person who gets really into whatever catches my interest. Whether it's " +
      'figuring out a tricky trail, learning something new on guitar, or spending way too much ' +
      'time perfecting a cup of coffee, I enjoy the process as much as the result. I like ' +
      'keeping a balance between getting outdoors, being creative, and occasionally ' +
      'disappearing down a new rabbit hole.',
    interests: [
      {
        name: 'Mountain Biking',
        description:
          'Mountain biking is one of my biggest passions, especially enduro and technical trail ' +
          'riding. I love the combination of physical effort, technical skill, and the ' +
          "adrenaline of a good descent. There's something incredibly satisfying about tackling " +
          'a difficult section, figuring out the right line, and finally getting it right. I ' +
          "ride both traditional mountain bikes and e-MTBs, and I'm always looking to improve " +
          'my technique and confidence on the trails.',
      },
      {
        name: 'Surfing',
        description:
          'Surfing is another way I love spending time outdoors. I enjoy the challenge of ' +
          'reading the waves, improving my technique, and the feeling of catching a good ride. ' +
          "Unlike most things, you can't control the conditions, and that's part of what makes " +
          "it interesting. It's a great way to disconnect from everything else and just focus " +
          "on what's happening in the water.",
      },
      {
        name: 'Running & Endurance Sports',
        description:
          "I enjoy pushing myself physically, whether that's through running, strength " +
          "training, or working on my overall fitness. I've been taking a more structured " +
          'approach to running, focusing on building endurance and improving my performance. ' +
          "I'm also interested in triathlons, with a half-Ironman as one of my longer-term " +
          'goals. I like having something to work toward and seeing the progress that comes ' +
          'from consistent training.',
      },
      {
        name: 'Photography',
        description:
          'Photography gives me a different way to be creative. I shoot with a Fujifilm X-T5 ' +
          'and enjoy experimenting with composition, lighting, and different focal lengths. I ' +
          'like the process of capturing a moment and then working with the RAW files to bring ' +
          "out what I had in mind. It's one of those hobbies where there's always something new " +
          "to learn, and it's a good excuse to slow down and pay attention to the details " +
          'around me.',
      },
      {
        name: 'Guitar & Music',
        description:
          "I've been playing guitar for years, with a particular love for classic rock and " +
          "blues. I play electric and classical guitar, although there's something about " +
          'picking up a Stratocaster and playing a good blues riff that never gets old. I enjoy ' +
          'learning new songs, experimenting with different tones, and gradually improving my ' +
          'playing. Music is one of my favorite ways to unwind and do something creative ' +
          'without staring at a screen.',
      },
      {
        name: 'Technology & Side Projects',
        description:
          "My interest in technology doesn't really stop when the workday ends. I enjoy " +
          'experimenting with software, automation, AI models, and different tools just to ' +
          'understand how they work. I like building my own applications, connecting systems ' +
          'together, and finding practical uses for new technologies. Sometimes a simple idea ' +
          'turns into a much bigger project, but figuring things out along the way is usually ' +
          'the fun part.',
      },
      {
        name: 'Coffee',
        description:
          "I enjoy making coffee almost as much as drinking it. I'm particularly into espresso " +
          'and milk-based drinks, and I like experimenting with grind size, extraction time, ' +
          "and different brewing methods. There's a surprising amount of detail behind making a " +
          'good cup of coffee, and I enjoy figuring out how small adjustments change the ' +
          "result. It's a small everyday hobby that can get pretty technical.",
      },
      {
        name: 'Gaming, Movies & Anime',
        description:
          'I enjoy PC gaming, especially racing games where I can spend as much time tuning a ' +
          "car as actually driving it. I'm also a big fan of movies and series, particularly " +
          'science fiction, psychological thrillers, and good comedies. Interstellar is one of ' +
          'my favorite films, and Attack on Titan is one of my favorite anime series. I love ' +
          'stories that make you think, surprise you, or leave you with something to talk about ' +
          'afterward.',
      },
      {
        name: 'Scar, My Four-Legged Sidekick 🐾',
        description:
          "Meet Scar, my four-legged best friend and occasional office buddy. He's a big part " +
          "of my life, whether we're spending time outdoors, relaxing at home, or he's joining " +
          "me for a day at work. He's also made his way into my developer portfolio as a " +
          "pixel-art character, so I guess he's officially part of the development team. Still " +
          'waiting for his first pull request, though.',
      },
    ],
  },
};
