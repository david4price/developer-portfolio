import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { profile } from '@portfolio/project-registry';
import { FloatingChat } from '@/components/floating-chat';
import { SiteNav } from '@/components/site-nav';
import './globals.css';

export const metadata: Metadata = {
  title: { default: profile.name, template: `%s · ${profile.name}` },
  description: profile.headline,
};

const navigation = [
  { href: '/', label: 'Home' },
  { href: '/projects/', label: 'Projects' },
  { href: '/experience/', label: 'Experience' },
  { href: '/about/', label: 'About' },
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <div className="container site-header__inner">
            <Link href="/" className="site-title">
              {profile.name}
            </Link>
            <SiteNav items={navigation} />
          </div>
        </header>
        <main id="main" className="container">
          {children}
        </main>
        <footer className="site-footer">
          <div className="container site-footer__inner">
            <span>{profile.name}</span>
            <a href="https://github.com/david4price/developer-portfolio">Source on GitHub</a>
          </div>
        </footer>
        <FloatingChat />
      </body>
    </html>
  );
}
