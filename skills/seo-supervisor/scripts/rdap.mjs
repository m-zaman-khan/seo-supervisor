#!/usr/bin/env node
// @ts-check
// Registration and expiry dates and the registrar of the site's and competitors' domains, from RDAP, the keyless
// successor of WHOIS. Domain age is never a finding.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { proxyNote } from "./lib/proxy.mjs";
import { domainOf } from "./connect-keys.mjs";

const BOOTSTRAP = "https://data.iana.org/rdap/dns.json";
const UA = "seo-supervisor-rdap";
const get = async url => {
  const r = await fetch(url, {
    headers: { accept: "application/rdap+json, application/json", "user-agent": UA },
    signal: AbortSignal.timeout(30000),
  });
  const body = /** @type {any} */ (await r.json().catch(() => null));
  return { status: r.status, body };
};
const reason = e => e.cause?.code || e.message;

// The longest match by whole labels from the right, preferring https. Base URLs take "domain/<name>" after a "/".
// https://www.rfc-editor.org/rfc/rfc9224
export function serverFor(services, labels) {
  let best = null;
  for (const [entries, urls] of services.filter(Array.isArray))
    for (const e of entries || []) {
      // a malformed entry is skipped
      const parts = String(e).toLowerCase().split(".");
      if (
        parts.length <= labels.length &&
        parts.join(".") === labels.slice(-parts.length).join(".") &&
        (!best || parts.length > best.size)
      )
        best = { size: parts.length, urls: urls || [] };
    }
  const url = best && (best.urls.find(u => /^https:/i.test(u)) || best.urls[0]);
  return url ? { size: best.size, base: url.endsWith("/") ? url : url + "/" } : null;
}
// Dates come from the registration and expiration events, the registrar from its entity's vCard fn.
// https://www.rfc-editor.org/rfc/rfc9083
const dayOf = (events, action) => {
  const d = (events || []).find(e => e?.eventAction === action)?.eventDate;
  return typeof d === "string" && /^\d{4}-\d\d-\d\d/.test(d) ? d.slice(0, 10) : null;
};
const registrarOf = entities => {
  const card = (entities || []).find(e => (e?.roles || []).includes("registrar"))?.vcardArray?.[1];
  const fn = Array.isArray(card) ? card.find(p => Array.isArray(p) && p[0] === "fn")?.[3] : null;
  return typeof fn === "string" && fn.trim() ? fn.trim() : null;
};

// domains are bare names like example.com.
export async function lookupDomains({ domains, bootstrap = BOOTSTRAP }) {
  const notes = [],
    domainAge = [];
  let services;
  try {
    const { status, body } = await get(bootstrap);
    services = Array.isArray(body?.services) ? body.services : null;
    if (!services)
      return {
        domainAge,
        notes: [
          `IANA's RDAP list (${bootstrap}) didn't answer as expected (HTTP ${status}), so no domain dates were read. Try again later.`,
        ],
      };
  } catch (e) {
    return {
      domainAge,
      notes: [
        `Couldn't reach IANA's RDAP list (${reason(e)}), so no domain dates were read. Check the internet connection and try again.`,
      ],
    };
  }
  for (const domain of domains) {
    const labels = domain.toLowerCase().split("."),
      server = serverFor(services, labels);
    if (!server) {
      notes.push(`${domain}: IANA lists no RDAP server for its ending, so its registration date wasn't read.`);
      continue;
    }
    // A subdomain isn't registered on its own: try the name, then its parent, down to one label more than the
    // registry's ending (shop.example.co.uk, then example.co.uk), never the ending itself.
    let found = null,
      last = null;
    for (let i = 0; labels.length - i > server.size && !found; i++) {
      const name = labels.slice(i).join(".");
      try {
        const { status, body } = await get(`${server.base}domain/${encodeURIComponent(name)}`);
        if (status === 200 && body) found = { name, body };
        else if (status !== 404) {
          last = `the registry answered HTTP ${status}`;
          break;
        } else last = "the registry doesn't know it (404)";
      } catch (e) {
        last = `couldn't reach ${new URL(server.base).host} (${reason(e)})`;
        break;
      }
    }
    if (!found) {
      notes.push(`${domain}: no registration data, ${last}.`);
      continue;
    }
    const { body } = found;
    domainAge.push({
      domain: found.name,
      registered: dayOf(body.events, "registration"),
      expires: dayOf(body.events, "expiration"),
      registrar: registrarOf(body.entities),
      server: new URL(server.base).host,
    });
  }
  return { domainAge, notes };
}

if (isMain(import.meta.url)) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i].replace(/^--/, "");
    args[k] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
  }
  const str = k => (typeof args[k] === "string" ? args[k] : null);
  const stop = msg => {
    console.error(msg);
    process.exitCode = 2;
  };
  let site = null;
  try {
    site = /^https?:$/.test(new URL(str("site")).protocol) && domainOf(str("site"));
  } catch {}
  if (!site)
    stop(
      `rdap: --site must be the site's address, like https://www.example.com (got ${args.site ?? "nothing"}).\nusage: node rdap.mjs --site https://www.example.com [--competitors a.com,b.com] [--out seo-audit/rdap.json] [--yes]`,
    );
  else {
    const listed = (str("competitors") || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    const skipped = listed
      .filter(c => !domainOf(c))
      .map(c => `Skipped competitor "${c}": it's not a domain name like rival.com.`);
    const domains = [site, ...listed.map(domainOf)].filter((d, i, all) => d && all.indexOf(d) === i);
    const bootstrap = process.env.RDAP_BOOTSTRAP || BOOTSTRAP;
    if (args.yes !== true) {
      console.log(
        `rdap: dry run, nothing sent. With --yes it would read IANA's list of RDAP servers (${new URL(bootstrap).host}), then send ${domains.length} domain name(s) (${domains.join(", ")}) to each one's registry, to read when it was registered and with which registrar. No key is needed.${skipped.length ? "\n" + skipped.join("\n") : ""}\nThese go to outside services, so re-run with --yes once the owner agrees.`,
      );
    } else {
      {
        const n = proxyNote();
        if (n) console.error("note: " + n);
      }
      const r = await lookupDomains({ domains, bootstrap });
      r.notes.push(...skipped);
      const out = resolve(str("out") || "seo-audit/rdap.json");
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify({ source: "rdap", when: new Date().toISOString(), ...r }, null, 2));
      for (const n of r.notes) console.log("note: " + n);
      console.log(`rdap: registration dates for ${r.domainAge.length} of ${domains.length} domain(s) · wrote ${out}`);
    }
  }
}
