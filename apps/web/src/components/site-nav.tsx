'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isCurrent } from '@/lib/nav';

export interface NavItem {
  readonly href: string;
  readonly label: string;
}

/** The main navigation; the current section is marked for assistive technology and styling. */
export function SiteNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname() ?? '/';
  return (
    <nav aria-label="Main">
      <ul className="nav-list">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={isCurrent(item.href, pathname) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
