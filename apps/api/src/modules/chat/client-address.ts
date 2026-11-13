import { isIP } from 'node:net';

/**
 * The quota bucket for a client address. IPv4 addresses (including IPv4-mapped IPv6) count
 * individually; IPv6 addresses count per /64, since one connection usually controls a whole /64
 * and could otherwise rotate addresses to dodge limits.
 */
export function clientBucket(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped?.[1]) return `v4:${mapped[1]}`;
  if (isIP(address) === 4) return `v4:${address}`;
  if (isIP(address) === 6) return `v6:${expandIpv6(address).slice(0, 4).join(':')}::/64`;
  return 'unknown';
}

function expandIpv6(address: string): string[] {
  const [head = '', tail = ''] = address.toLowerCase().split('%')[0]?.split('::') ?? [];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = address.includes('::') ? 8 - left.length - right.length : 0;
  return [...left, ...Array<string>(missing).fill('0'), ...right].map((part) =>
    part.padStart(4, '0'),
  );
}

/**
 * The visitor's address. `CF-Connecting-IP` is used only when the deployment says every request
 * comes through Cloudflare; otherwise (or if the header is malformed) the socket address is used.
 */
export function clientAddress(
  socketAddress: string | undefined,
  cfConnectingIp: string | string[] | undefined,
  trustCloudflare: boolean,
): string {
  if (trustCloudflare && typeof cfConnectingIp === 'string' && isIP(cfConnectingIp.trim())) {
    return cfConnectingIp.trim();
  }
  return socketAddress ?? 'unknown';
}
