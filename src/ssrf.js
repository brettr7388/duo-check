// SSRF guard. Pure functions plus an injectable DNS resolver, so they can be unit tested in Node.
// The renderer runs in Cloudflare's browser fleet, not on a private network, but we still refuse anything
// that points at private, loopback or link-local space, any credentials, any odd port and any non-http(s) scheme.

export const MAX_URL_LENGTH = 2048;

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa', '.lan', '.intranet', '.corp', '.home'];

/** Parse dotted-quad into 4 numbers or null. The WHATWG URL parser already turns 2130706433 / 0x7f.1 into dotted form. */
export function parseIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n >= 0 && n <= 255) ? o : null;
}

export function isBlockedIPv4(o) {
  const [a, b, c] = o;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||        // CGNAT
    (a === 169 && b === 254) ||                  // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||         // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) ||         // TEST-NET-1
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||     // benchmarking
    (a === 198 && b === 51 && c === 100) ||      // TEST-NET-2
    (a === 203 && b === 0 && c === 113) ||       // TEST-NET-3
    a >= 224                                     // multicast, reserved, broadcast
  );
}

/** Expand an IPv6 literal (no brackets) into 8 numeric groups, or null. */
export function parseIPv6(host) {
  let h = host.toLowerCase();
  if (h.includes('%')) return null;
  let tail = [];
  const lastColon = h.lastIndexOf(':');
  const maybeV4 = h.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const v4 = parseIPv4(maybeV4);
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    h = h.slice(0, lastColon + 1) + '0:0';
  }
  const halves = h.split('::');
  if (halves.length > 2) return null;
  const parse = (s) => (s === '' ? [] : s.split(':'));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const groups = halves.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - rest.length)).fill('0'), ...rest] : head;
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  if (nums.some(Number.isNaN)) return null;
  if (tail.length) { nums[6] = tail[0]; nums[7] = tail[1]; }
  return nums;
}

export function isBlockedIPv6(g) {
  const allZeroUpTo = (n) => g.slice(0, n).every((x) => x === 0);
  const embeddedV4 = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255];
  if (allZeroUpTo(7) && (g[7] === 0 || g[7] === 1)) return true;             // :: and ::1
  if (allZeroUpTo(5) && g[5] === 0xffff) return isBlockedIPv4(embeddedV4(g[6], g[7])); // ::ffff:a.b.c.d
  if (allZeroUpTo(6)) return true;                                              // deprecated IPv4-compatible ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedIPv4(embeddedV4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isBlockedIPv4(embeddedV4(g[1], g[2]));            // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true;                                  // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true;                                  // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true;                                  // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                          // documentation
  return false;
}

/** True if a bare IP (v4 or v6, no brackets) is in a blocked range. Non-IPs return false. */
export function isBlockedIp(ip) {
  const v4 = parseIPv4(ip);
  if (v4) return isBlockedIPv4(v4);
  if (ip.includes(':')) {
    const v6 = parseIPv6(ip);
    return v6 ? isBlockedIPv6(v6) : true; // unparseable IPv6 shape: fail closed
  }
  return false;
}

/**
 * Check a user-typed or redirected URL without touching the network.
 * Returns { ok: true, url: URL } or { ok: false, reason }.
 */
export function checkUrlLiteral(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'Paste a URL first.' };
  let s = input.trim();
  if (!s) return { ok: false, reason: 'Paste a URL first.' };
  if (s.length > MAX_URL_LENGTH) return { ok: false, reason: 'That URL is absurdly long.' };
  if (/[\u0000-\u001f\u007f\s]/.test(s)) return { ok: false, reason: 'That does not look like a URL.' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (/^(javascript|data|file|blob|about|chrome|view-source|ftp|mailto|tel|ws|wss):/i.test(s)) return { ok: false, reason: 'Only http and https sites work.' };
    s = 'https://' + s;
  }
  let u;
  try { u = new URL(s); } catch { return { ok: false, reason: 'That does not look like a URL.' }; }
  return checkParsedUrl(u);
}

export function checkParsedUrl(u) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'Only http and https sites work.' };
  if (u.username || u.password) return { ok: false, reason: 'URLs with a username or password are not allowed.' };
  if (u.port) return { ok: false, reason: 'Only the default web ports (80 and 443) are allowed.' };
  let host = u.hostname.toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host) return { ok: false, reason: 'That does not look like a URL.' };
  if (host.startsWith('[') && host.endsWith(']')) {
    const g = parseIPv6(host.slice(1, -1));
    if (!g || isBlockedIPv6(g)) return { ok: false, reason: 'That address is private. Public sites only.' };
    return { ok: true, url: u };
  }
  if (parseIPv4(host)) {
    return isBlockedIp(host) ? { ok: false, reason: 'That address is private. Public sites only.' } : { ok: true, url: u };
  }
  if (/^[0-9.]+$/.test(host) || /^0x[0-9a-f.]+$/i.test(host)) return { ok: false, reason: 'That does not look like a URL.' };
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((x) => host.endsWith(x))) return { ok: false, reason: 'That host is private. Public sites only.' };
  if (!host.includes('.')) return { ok: false, reason: 'Needs a real domain, like example.com.' };
  return { ok: true, url: u };
}

/** Resolve A and AAAA over DNS-over-HTTPS. Returns the list of IPs. Throws when the lookup itself fails. */
export async function dohResolve(host, fetchImpl = fetch) {
  const out = [];
  for (const type of ['A', 'AAAA']) {
    const r = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
    if (!r.ok) throw new Error('dns lookup failed');
    const j = await r.json();
    for (const a of j.Answer || []) if (a.type === (type === 'A' ? 1 : 28)) out.push(a.data);
  }
  return out;
}

/** Literal check plus DNS: refuse hostnames that resolve to private space (e.g. nip.io style names). Fails closed. */
export async function checkUrlResolved(input, resolve = dohResolve) {
  const lit = checkUrlLiteral(input);
  if (!lit.ok) return lit;
  const host = lit.url.hostname.replace(/\.$/, '');
  if (parseIPv4(host) || host.startsWith('[')) return lit;
  let ips;
  try { ips = await resolve(host); } catch { return { ok: false, reason: 'Could not verify that host is public. Try again in a moment.' }; }
  if (!ips.length) return { ok: false, reason: 'That domain does not resolve. Typo?' };
  if (ips.some((ip) => isBlockedIp(ip))) return { ok: false, reason: 'That host points at a private address. Public sites only.' };
  return lit;
}

/** Stable cache key input: lowercase host, no fragment, no default port, bare path becomes "/". */
export function normalizeUrl(u) {
  const x = new URL(u.href);
  x.hash = '';
  x.hostname = x.hostname.toLowerCase().replace(/\.$/, '');
  return x.href;
}
