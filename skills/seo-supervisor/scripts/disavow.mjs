#!/usr/bin/env node
// @ts-check
// Writes a disavow file from hand-picked domains and pages. It never chooses entries, and never uploads: Search Console
// has no API for it.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { parseArgs } from "./lib/args.mjs";
import { Fail, runMain } from "./lib/cli.mjs";

const USAGE =
  'usage: node disavow.mjs --site https://www.example.com (--domains "a.com,b.com" and/or --urls links.txt) [--existing <the disavow file already in Search Console>] [--reason "…"] [--out seo-audit/disavow.txt]';
const fail = msg => {
  throw new Fail("disavow: " + msg);
};
// Google's limits: a UTF-8 .txt file of 100,000 lines (blank and comment lines included) and 2 MB, read strictly as
// 2,000,000 bytes; URLs up to 2,048 characters. https://support.google.com/webmasters/answer/2648487
const MAX_LINES = 100000,
  MAX_BYTES = 2000000,
  MAX_URL = 2048,
  TOOL = "https://search.google.com/search-console/disavow-links";
const bare = h => h.toLowerCase().replace(/^www\./, "");
const LABEL = "(?!-)[a-z0-9-]{1,63}(?<!-)",
  HOST = new RegExp(`^${LABEL}(\\.${LABEL})*\\.(?!\\d+$)${LABEL}$`);
// A bare host name, lower-cased and in its xn-- form; null for anything with a scheme, path, port or space.
const hostOf = s => {
  try {
    return /[/\\:@?#\s]/.test(s) ? null : (h => (HOST.test(h) ? h : null))(new URL("http://" + s).hostname);
  } catch {
    return null;
  }
};
// http:// or https:// then a host. Node parses "http:spam.com" and "https:/spam.com", but the file keeps lines as
// written, so those are refused.
const isUrl = s => {
  try {
    return /^https?:\/\/[^/\\\s]/i.test(s) && !/\s/.test(s) && !!new URL(s).hostname;
  } catch {
    return false;
  }
};
// Duplicates: domain lines in any case, URLs as written. Subdomains are never merged, as Google doesn't say whether
// domain:example.com covers blog.example.com.
const keyOf = line => (/^domain:/i.test(line) ? line.toLowerCase() : line);
const lines = f => {
  let t;
  try {
    t = readFileSync(f, "utf8")
      .replace(/^﻿/, "")
      .replace(/\r?\n$/, "");
  } catch (e) {
    fail(`couldn't read ${f} (${e.code === "ENOENT" ? "it isn't there" : e.code}).`);
  }
  return t ? t.split(/\r?\n/) : [];
};

function main(argv) {
  const args = parseArgs(argv, {
    flags: ["site", "domains", "urls", "existing", "reason", "out"],
    positionals: 0,
    usage: USAGE,
  });
  const str = k => (typeof args[k] === "string" ? args[k] : null);
  if (!str("site") || !("domains" in args || "urls" in args)) throw new Fail(USAGE);
  let site;
  try {
    site = new URL(args.site);
  } catch {}
  if (!site || !/^https?:$/.test(site.protocol))
    fail(`--site must be the site's address, like https://www.example.com (got ${args.site})`);
  const own = bare(site.hostname),
    mine = h => {
      const b = bare(h);
      return b === own || b.endsWith("." + own) || own.endsWith("." + b);
    };
  const notMine = (h, what) => {
    if (mine(h)) fail(`${what} is your own site (${site.host}). Never disavow links from your own site.`);
  };
  const out = resolve(str("out") || "seo-audit/disavow.txt");
  if (!/\.txt$/i.test(out)) fail(`--out must end in .txt: Google's disavow tool takes only .txt files (got ${out}).`);

  const add = [];
  for (const d of (str("domains") || "").split(/[,\s]+/).filter(Boolean)) {
    const h = hostOf(d.replace(/^domain:/i, ""));
    if (!h)
      fail(
        `"${d}" isn't a domain name like spam.example. Give names without http:// or a path; put single pages in a file for --urls.`,
      );
    notMine(h, d);
    add.push(`domain:${h}`);
  }
  if (str("urls"))
    lines(args.urls).forEach((raw, i) => {
      const l = raw.trim();
      if (!l || l.startsWith("#")) return;
      if (!isUrl(l))
        fail(
          `${args.urls} line ${i + 1} isn't a web address: "${l.slice(0, 100)}". Put one full URL per line, like https://spam.example/page; whole sites go in --domains.`,
        );
      if (l.length > MAX_URL)
        fail(
          `${args.urls} line ${i + 1} is ${l.length.toLocaleString("en-US")} characters long; Google takes URLs of up to 2,048.`,
        );
      notMine(new URL(l).hostname, l);
      add.push(l);
    });
  if (!add.length)
    fail("no domains or URLs to disavow were given. Pick them first; the file is never filled in for you.");

  // An upload replaces the property's whole list, so every existing line is carried over.
  const old = str("existing") ? lines(args.existing) : [];
  old.forEach((raw, i) => {
    const l = raw.trim();
    if (!l || l.startsWith("#")) return;
    const h = isUrl(l) ? new URL(l).hostname : /^domain:/i.test(l) ? hostOf(l.slice(7)) : null;
    if (!h)
      fail(
        `${args.existing} line ${i + 1} isn't a disavow line: "${l.slice(0, 100)}". Pass the disavow file for this property, as it is in Search Console.`,
      );
    // Disavowing the site itself is almost certainly a mistake that's hurting it, so it stops the run.
    if (mine(h))
      fail(
        `${args.existing} line ${i + 1} disavows your own site (${site.host}): "${l.slice(0, 100)}". That's almost certainly a mistake. Remove that line from the file, run this again, and upload the new file.`,
      );
  });
  const seen = new Set(old.map(l => keyOf(l.trim()))),
    fresh = add.filter(l => !seen.has(keyOf(l)) && seen.add(keyOf(l)));
  const known = add.length - fresh.length;
  if (!fresh.length)
    fail(`nothing new: every domain and URL given is already in ${str("existing") ? args.existing : "the list"}.`);

  const reason = (str("reason") || "").replace(/\s+/g, " ").trim(),
    date = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
  const all = [
    ...old,
    ...(old.length ? [""] : []),
    `# Added ${date}${reason ? `: ${reason}` : " with disavow.mjs"}`,
    ...fresh,
  ];
  const text = all.join("\n") + "\n",
    bytes = Buffer.byteLength(text);
  if (all.length > MAX_LINES)
    fail(
      `the file would have ${all.length.toLocaleString("en-US")} lines; Google takes at most 100,000 lines, blank and comment lines included. Use domain: lines in place of many pages from one site.`,
    );
  if (bytes > MAX_BYTES)
    fail(
      `the file would be ${(bytes / 1e6).toFixed(1)} MB; Google takes at most 2 MB. Use domain: lines in place of many pages from one site.`,
    );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);

  const n = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`,
    doms = fresh.filter(l => l.startsWith("domain:")).length;
  console.log(
    [
      `disavow: wrote ${out}: ${[doms && n(doms, "domain"), fresh.length > doms && n(fresh.length - doms, "URL")].filter(Boolean).join(" and ")} added${old.length ? `, ${n(old.length, "line")} kept from ${args.existing}` : ""}${known ? `, ${known} already in the list` : ""}.`,
      "",
      "Before you upload:",
      "- Most sites never need this. Google can usually tell which links to trust on its own. Use it only for a manual action for unnatural links, or for links you know were paid for or made to manipulate rankings, after asking the sites to remove them.",
      `- Uploading replaces the list already in Search Console. ${old.length ? "This file keeps every line of the old list, so nothing is lost." : "If you uploaded a disavow file for this property before, run this again with --existing and that file, or its lines will be lost."}`,
      "- A wrong disavow can hurt the site in Google Search. Read every line first.",
      "",
      "To upload it (only a property owner can):",
      `1. Open ${TOOL}`,
      `2. Pick the URL-prefix property for ${site.origin}/. The tool doesn't work with Domain properties. If you have both http and https properties, upload the file to each.`,
      "3. Upload the file. If Google lists errors, the old list stays; fix the file and upload it again.",
      "It can take a few weeks for Google to use the list. If there's a manual action, then ask for a review in Search Console's Manual actions report.",
      // https://blogs.bing.com/webmaster/september-2023/Bing-Webmaster-Tools-to-Remove-Disavow-Links-Feature-in-October-2023
      "Bing has no disavow tool: it removed it in October 2023.",
    ].join("\n"),
  );
  return 0;
}

if (isMain(import.meta.url)) await runMain(() => main(process.argv.slice(2)));
