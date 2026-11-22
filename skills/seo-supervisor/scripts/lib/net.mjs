// @ts-check
// The one private-address guard, and a request that keeps to it.
import { lookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

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
// This machine, by name or address (0.0.0.0: what Django and Rails print).
export const loopback = h => /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|\[::1\])$/i.test(h);

const open = (u, opts) =>
  new Promise((ok, ko) => (u.startsWith("https:") ? httpsRequest : httpRequest)(u, opts, ok).on("error", ko).end());

/** One request that connects only where the guard allows: redirects are followed by hand, allow(url) is asked before
 * each hop, and every connection goes through guarded(dns), so the address checked is the one used. read(res, url) gets
 * the first answer that isn't a redirect and its result is returned (by default the status, the body unread); the
 * timeout covers read too. { reason } in plain words when a hop isn't allowed, there are more than hops redirects,
 * nothing answers in time or the connection fails.
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, allow?: (u: string) => boolean | Promise<boolean>, dns?: any, timeout?: number, hops?: number, read?: (res: import("node:http").IncomingMessage, url: string) => any }} [o] */
export async function pinnedGet(
  url,
  {
    method = "GET",
    headers = {},
    allow = isPublic,
    dns = lookup,
    timeout = 15000,
    hops = 5,
    read = r => (r.destroy(), { status: r.statusCode }),
  } = {},
) {
  const signal = AbortSignal.timeout(timeout),
    connect = guarded(dns);
  let u = url;
  try {
    for (let hop = 0; hop <= hops; hop++) {
      if (!(await allow(u)))
        return {
          reason: hop
            ? `it redirects to ${u}, which isn't a public web address, so that wasn't visited`
            : "it isn't a public web address, so it wasn't visited",
        };
      const r = /** @type {import("node:http").IncomingMessage} */ (
        await open(u, { method, signal, lookup: connect, headers })
      );
      const to = r.statusCode >= 300 && r.statusCode < 400 && r.headers.location;
      if (to) {
        r.destroy();
        u = new URL(to, u).href;
        continue;
      }
      return await read(r, u);
    }
    return { reason: `it redirects more than ${hops} times` };
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
