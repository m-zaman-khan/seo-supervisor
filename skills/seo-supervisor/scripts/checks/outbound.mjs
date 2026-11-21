// Checks links to other sites. Runs only with the crawler's --outbound-links, since it visits other people's sites.
// Only 404 and 410 count as broken; a refusal, an error or no answer means the link couldn't be checked.
import { lookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

const UA = "seo-supervisor-links",
  AT_ONCE = 4,
  HOPS = 5;

export const CHECKS = {
  "outbound-broken": [
    "CRAWL-07",
    "low",
    n => `${n} link(s) to other sites are broken`,
    "These links point at pages on other sites that answer 404 or 410: the page is gone. Visitors who follow them hit a dead end, and a page full of dead links looks neglected.",
    "Update each link to the page's new address, link to another source, or remove it. Links that couldn't be checked (the site turned the visit away or didn't answer) aren't counted here; the notes list them.",
  ],
};

// The private-address guard; backlinks.mjs imports it from here.
// Private, local and reserved addresses: what seo-crawl.mjs's isPublic refuses, plus benchmarking, multicast, reserved
// and broadcast, NAT64 and IPv4 inside IPv6 (BlockList reads ::ffff:127.0.0.1 as 127.0.0.1). A non-IP counts too.
const PRIVATE = new BlockList();
for (const s of [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/3",
  "::/96",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8",
  "64:ff9b::/96",
  "64:ff9b:1::/48",
]) {
  const [a, n] = s.split("/");
  PRIVATE.addSubnet(a, +n, isIP(a) === 6 ? "ipv6" : "ipv4");
}
export const privateIp = a => !isIP(a) || PRIVATE.check(a, isIP(a) === 6 ? "ipv6" : "ipv4");
// The address: no private IP, no intranet or reserved name. The name's own answer is checked when connecting (guarded).
export const isPublic = u => {
  try {
    const { protocol, hostname: h } = new URL(u);
    return (
      /^https?:$/.test(protocol) &&
      h.includes(".") &&
      !(/^[\d.]+$/.test(h) && privateIp(h)) &&
      !/\.(local|internal|lan|localhost|test|home\.arpa)$/i.test(h)
    );
  } catch {
    return false;
  }
};
// The lookup every request connects with, so the address checked is the one used: a name can't pass a check and then
// answer differently (DNS rebinding). A name that doesn't resolve fails the visit.
export const guarded = dns => (name, opts, cb) =>
  dns(name, opts, (err, addr, family) => {
    const bad = !err && (Array.isArray(addr) ? addr.map(a => a.address) : [addr]).find(privateIp);
    bad
      ? cb(
          Object.assign(new Error(`${name} points at a private or local address (${bad}), so it wasn't visited`), {
            code: "ENOTPUBLIC",
          }),
        )
      : cb(err, addr, family);
  });

const open = (u, opts) =>
  new Promise((done, fail) =>
    (u.startsWith("https:") ? httpsRequest : httpRequest)(u, opts, r => {
      done({ status: r.statusCode, location: r.headers.location });
      r.destroy();
    })
      .on("error", fail)
      .end(),
  );

// One request that connects only where the guard allows: redirects are followed by hand and allow(url) is asked before
// each hop. { status }, or { reason } in plain words when a hop isn't allowed, there are more than HOPS redirects,
// nothing answers in time or the connection fails.
async function load(url, method, { allow, timeout, connect }) {
  const signal = AbortSignal.timeout(timeout);
  let u = url;
  try {
    for (let hop = 0; hop <= HOPS; hop++) {
      if (!(await allow(u)))
        return {
          reason: hop
            ? `it redirects to ${u}, which isn't a public web address, so that wasn't visited`
            : "it isn't a public web address, so it wasn't visited",
        };
      const r = await open(u, { method, signal, lookup: connect, headers: { "user-agent": UA, accept: "*/*" } });
      if (r.status >= 300 && r.status < 400 && r.location) {
        u = new URL(r.location, u).href;
        continue;
      }
      return { status: r.status };
    }
    return { reason: `it redirects more than ${HOPS} times` };
  } catch (e) {
    return {
      reason: signal.aborted
        ? `no answer within ${timeout / 1000} seconds`
        : e.code === "ENOTPUBLIC"
          ? e.message
          : `couldn't connect (${e.code || e.cause?.code || e.message})`,
    };
  }
}
const ok = s => s >= 200 && s < 300;
// GET only when HEAD gets no 2xx, since some servers refuse HEAD. The body is never read, and a link that couldn't be
// reached isn't tried again.
async function probe(url, o) {
  const head = await load(url, "HEAD", o);
  if (head.reason || ok(head.status)) return head;
  return load(url, "GET", o);
}

// Private, local and reserved addresses are never visited: allow checks the address each connection uses, on every
// redirect, and dns (dns.lookup's signature) gives the answer that's checked and used.
export async function checkOutbound(urls, { limit = 100, timeout = 15000, allow = isPublic, dns = lookup } = {}) {
  const list = [...new Set(urls)].slice(0, limit),
    results = [],
    o = { allow, timeout, connect: guarded(dns) };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        results[i] = { url: list[i], ...(await probe(list[i], o)) };
      }
    }),
  );
  // Only 404 and 410 are broken; a refusal, an error or no answer means the link couldn't be checked.
  return {
    broken: results.filter(r => r.status === 404 || r.status === 410).map(({ url, status }) => ({ url, status })),
    unreachable: results
      .filter(r => r.reason || (!ok(r.status) && r.status !== 404 && r.status !== 410))
      .map(({ url, status, reason }) => ({ url, reason: reason || `the site answered ${status}` })),
  };
}
