// Address classification for §9's SSRF rule: "reject private/loopback/link-local
// addresses."
//
// Split out from fetch.js and written as pure functions over strings because this is the
// one part of the fetch layer that can be tested exhaustively without a socket, and it is
// the part where a miss is a vulnerability rather than a bug. Everything here answers one
// question: may a fetcher connect to this address?
//
// The rule is enforced on the *resolved address*, never on the hostname. A hostname tells
// you nothing — `localtest.me` resolves to 127.0.0.1, and an attacker controls their own
// zone — so `fetch.js` hooks the DNS lookup and checks what came back, before the socket
// connects. Checking after connecting would leave a rebinding window.

/** Parse dotted-quad IPv4 into a 32-bit integer, or null if it is not one. */
export function parseIPv4(s) {
  const parts = String(s).split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    // Reject leading zeros: "0177.0.0.1" is octal to some resolvers and decimal to others,
    // and that disagreement is itself a bypass.
    if (!/^(0|[1-9][0-9]{0,2})$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out = out * 256 + n;
  }
  return out >>> 0;
}

/** Parse IPv6 into eight 16-bit groups, or null. Handles `::` and a trailing IPv4 tail. */
export function parseIPv6(s) {
  let text = String(s);
  if (text.includes('%')) text = text.slice(0, text.indexOf('%')); // strip zone id
  if (!text.includes(':')) return null;

  let tail = [];
  const lastColon = text.lastIndexOf(':');
  const maybeV4 = text.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const v4 = parseIPv4(maybeV4);
    if (v4 === null) return null;
    tail = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    text = text.slice(0, lastColon + 1) + '0';
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const toGroups = (part) => {
    if (part === '') return [];
    const out = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const index = toGroups(halves[0]);
  if (index === null) return null;
  let rest = halves.length === 2 ? toGroups(halves[1]) : [];
  if (rest === null) return null;

  // The synthesized '0' standing in for the IPv4 tail is not a real group.
  if (tail.length) {
    if (halves.length === 2 && rest.length) rest = rest.slice(0, -1);
    else if (halves.length === 1) index.pop();
  }

  const groups = halves.length === 2
    ? [...index, ...Array(8 - tail.length - index.length - rest.length).fill(0), ...rest, ...tail]
    : [...index, ...rest, ...tail];

  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

const inV4Range = (ip, prefix, bits) => (ip >>> (32 - bits)) === (prefix >>> (32 - bits));

/**
 * Is this IPv4 address one a fetcher may connect to? Everything reserved, private, or
 * otherwise not a public destination is refused.
 */
export function isPublicIPv4(ip) {
  if (ip === null) return false;
  const blocked = [
    [0x00000000, 8],  // 0.0.0.0/8       this network, and the "unspecified" address
    [0x0a000000, 8],  // 10.0.0.0/8      private
    [0x64400000, 10], // 100.64.0.0/10   CGNAT — routable-looking, reachable on many hosts
    [0x7f000000, 8],  // 127.0.0.0/8     loopback
    [0xa9fe0000, 16], // 169.254.0.0/16  link-local, which is where cloud metadata lives
    [0xac100000, 12], // 172.16.0.0/12   private
    [0xc0000000, 24], // 192.0.0.0/24    IETF protocol assignments
    [0xc0000200, 24], // 192.0.2.0/24    TEST-NET-1
    [0xc0a80000, 16], // 192.168.0.0/16  private
    [0xc6120000, 15], // 198.18.0.0/15   benchmarking
    [0xc6336400, 24], // 198.51.100.0/24 TEST-NET-2
    [0xcb007100, 24], // 203.0.113.0/24  TEST-NET-3
    [0xe0000000, 4],  // 224.0.0.0/4     multicast
    [0xf0000000, 4],  // 240.0.0.0/4     reserved, and 255.255.255.255 with it
  ];
  return !blocked.some(([prefix, bits]) => inV4Range(ip, prefix, bits));
}

/**
 * Is this IPv6 address one a fetcher may connect to?
 *
 * The embedded-IPv4 forms are the interesting cases: `::ffff:127.0.0.1`, `64:ff9b::7f00:1`,
 * and `2002:7f00:1::` all reach loopback through an address that passes a naive IPv6 check.
 * Each is unwrapped and judged as the IPv4 address it carries.
 */
export function isPublicIPv6(groups) {
  if (groups === null) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const embedded = (hi, lo) => (((hi << 16) >>> 0) + lo) >>> 0;

  if (groups.every((g) => g === 0)) return false;                    // ::   unspecified
  if (groups.slice(0, 7).every((g) => g === 0) && g7 === 1) return false; // ::1 loopback

  // ::ffff:a.b.c.d — IPv4-mapped. Also ::a.b.c.d, the deprecated IPv4-compatible form, and
  // ::ffff:0:a.b.c.d — the IPv4-*translated* form (RFC 2765), which puts the `ffff` one group
  // earlier and was the one this check missed: `::ffff:0:7f00:1` reaches loopback and fell
  // through to `return true`.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0) {
    if (g4 === 0 && (g5 === 0xffff || g5 === 0)) return isPublicIPv4(embedded(g6, g7));
    if (g4 === 0xffff && g5 === 0) return isPublicIPv4(embedded(g6, g7));
  }
  // 64:ff9b::/96 and 64:ff9b:1::/48 — NAT64 well-known prefixes.
  if (g0 === 0x0064 && g1 === 0xff9b) return isPublicIPv4(embedded(g6, g7));
  // 2002::/16 — 6to4 carries its IPv4 in the next 32 bits.
  if (g0 === 0x2002) return isPublicIPv4(embedded(g1, g2));

  if ((g0 & 0xfe00) === 0xfc00) return false; // fc00::/7   unique local
  if ((g0 & 0xffc0) === 0xfe80) return false; // fe80::/10  link-local
  if ((g0 & 0xff00) === 0xff00) return false; // ff00::/8   multicast
  if (g0 === 0x0100 && g1 === 0) return false; // 100::/64  discard-only
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // 2001:db8::/32 documentation
  // The IETF protocol-assignments block, 2001::/23, of which three sub-blocks are addresses no
  // fetch should reach: Teredo tunnels an arbitrary IPv4 destination — including a private one —
  // through an address whose own prefix looks routable, and ORCHID names hashes rather than hosts.
  if (g0 === 0x2001 && g1 === 0) return false;             // 2001::/32     Teredo
  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x0010) return false; // 2001:10::/28 ORCHID (deprecated)
  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x0020) return false; // 2001:20::/28 ORCHIDv2
  return true;
}

/**
 * The default address policy (spec §9). `fetch.js` applies this to every address DNS
 * returns, before connecting, and refuses the fetch if none survive.
 */
export function isPublicAddress(address) {
  const v4 = parseIPv4(address);
  if (v4 !== null) return isPublicIPv4(v4);
  return isPublicIPv6(parseIPv6(address));
}

/**
 * A policy that also permits loopback. Present so the transport can be exercised against a
 * local server; it is never the default, and nothing in `src/` selects it.
 */
export function isPublicOrLoopbackAddress(address) {
  if (isPublicAddress(address)) return true;
  const v4 = parseIPv4(address);
  if (v4 !== null) return inV4Range(v4, 0x7f000000, 8);
  const g = parseIPv6(address);
  return g !== null && g.slice(0, 7).every((x) => x === 0) && g[7] === 1;
}
