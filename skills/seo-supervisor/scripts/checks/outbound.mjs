// @ts-check
// Checks links to other sites. Runs only with the crawler's --outbound-links, since it visits other people's sites.
import { lookup } from "node:dns";
import { isPublic, pinnedGet } from "../lib/net.mjs";

// Re-exported for callers that import the address guard from here.
export { privateIp, isPublic, guarded } from "../lib/net.mjs";

const UA = "seo-supervisor-links",
  AT_ONCE = 4;

export const CHECKS = {
  "outbound-broken": [
    "CRAWL-07",
    "low",
    n => `${n} link(s) to other sites are broken`,
    "These links point at pages on other sites that answer 404 or 410: the page is gone. Visitors who follow them hit a dead end, and a page full of dead links looks neglected.",
    "Update each link to the page's new address, link to another source, or remove it. Links that couldn't be checked (the site turned the visit away or didn't answer) aren't counted here; the notes list them.",
  ],
};

const ok = s => s >= 200 && s < 300;
// GET only when HEAD gets no 2xx, since some servers refuse HEAD. The body is never read, and a link that couldn't be
// reached isn't tried again.
async function probe(url, o) {
  const head = await pinnedGet(url, { method: "HEAD", ...o });
  if (head.reason || ok(head.status)) return head;
  return pinnedGet(url, { method: "GET", ...o });
}

// Private, local and reserved addresses are never visited: allow checks the address each connection uses, on every
// redirect, and dns (dns.lookup's signature) gives the answer that's checked and used.
export async function checkOutbound(urls, { limit = 100, timeout = 15000, allow = isPublic, dns = lookup } = {}) {
  const list = [...new Set(urls)].slice(0, limit),
    results = [],
    o = { allow, timeout, dns, headers: { "user-agent": UA, accept: "*/*" } };
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
