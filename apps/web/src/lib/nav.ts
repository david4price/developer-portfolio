/** Without a trailing slash (except the root), so `/about` and `/about/` compare equal. */
const trimmed = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/**
 * Whether `href` is the current section: the home page only on itself, any other page on itself
 * and anything below it (a project page counts as Projects).
 */
export function isCurrent(href: string, pathname: string): boolean {
  const page = trimmed(href);
  const here = trimmed(pathname);
  return page === '/' ? here === '/' : here === page || here.startsWith(`${page}/`);
}
