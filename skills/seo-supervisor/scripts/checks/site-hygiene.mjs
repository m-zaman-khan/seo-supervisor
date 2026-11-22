// @ts-check
// Duplicate analytics, exposed keys, hidden links, review and event schema, app link files, PDFs and Markdown copies.
import { HIDDEN_MIN, PDF_PAGES, JS_CAPS, APP_FILES, secretsIn, appFile } from "./hygiene.mjs";
import { pathKey, upTo, urlOr } from "../crawl/fetch.mjs";
import { NOSPACE_RUN } from "../lib/html.mjs";
import { mainWords as pickMainWords } from "../keyword-ideas.mjs";

// Analytics and secret keys are checked on every page read, since both matter on pages search engines skip too; the
// rest only on indexable pages. UA is the crawler's user agent, sent for the app link files.
export async function hygieneChecks(site, UA) {
  const { htmlPages, home, add, notes, extra, startOrigin: START_ORIGIN, get, indexable, selfHosts, bareHost } = site;
  const read = htmlPages.filter(p => p.hygieneSignals);
  // The business nodes at the top of the home page's schema are the site's own; a rated business elsewhere is the same
  // one when its @id or name matches.
  const key = s => s.replace(/\s+/g, " ").toLowerCase(),
    own = home?.hygieneSignals?.schema.orgs || [];
  const ownId = new Set(own.map(o => o.id).filter(Boolean)),
    ownName = new Set(own.map(o => key(o.name)).filter(Boolean));
  for (const p of read) {
    const h = p.hygieneSignals,
      u = p.finalUrl;
    if (h.analytics.length) add("analytics-tag-twice", u, h.analytics.join("; "));
    if (h.keys.length) add("secret-key-exposed", u, h.keys.join("; "));
    // Keeps the key's words out of the words file.
    if (h.scrub.length && typeof p.mainWordsText === "string") {
      const drop = new Set(h.scrub);
      p.mainWordsText = p.mainWordsText
        .split(" ")
        .filter(w => !drop.has(w))
        .join(" ");
    }
    if (!indexable(p) || p.clientOnly) continue;
    const away = h.hidden.filter(x => {
      const y = urlOr(x);
      return y && !selfHosts.has(bareHost(y.host));
    });
    if (away.length >= HIDDEN_MIN)
      add("hidden-links", u, `${away.length} hidden link(s) to other sites, e.g. ${away[0]}`);
    if (h.schema.events.length) add("event-online", u, h.schema.events.map(e => `“${e}”`).join(", "));
    if (h.schema.reviews.length) add("review-target-conflict", u, h.schema.reviews.join("; "));
    const self = [
      ...new Map(
        h.schema.rated.filter(x => ownId.has(x.id) || ownName.has(key(x.name))).map(x => [x.id || key(x.name), x]),
      ).values(),
    ];
    if (self.length)
      add(
        "rating-self-serving",
        u,
        self.map(x => `${x.kind} “${x.name || x.id}”${x.type ? ` (${x.type})` : ""}`).join("; "),
      );
  }
  // Builds often bake a server setting into the scripts browsers get. Each on-site script is read once, most-loaded
  // first, without following redirects, so no other host is asked; an HTML answer (an app shell served for every path)
  // is skipped, and source maps aren't read. JS_CAPS are local limits. A script that redirects isn't read; follow
  // on-site hops if that turns up.
  const scripts = new Map(); // crawl URL -> the pages that load it
  for (const p of read)
    for (const s of p.hygieneSignals.js) (scripts.get(s) || scripts.set(s, []).get(s)).push(p.finalUrl);
  let jsRead = 0,
    jsBytes = 0,
    jsUnread = 0;
  for (const [src, from] of [...scripts].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    if (jsRead >= JS_CAPS.files || jsBytes >= JS_CAPS.all) {
      jsUnread++;
      continue;
    }
    jsRead++;
    const cap = Math.min(JS_CAPS.each, JS_CAPS.all - jsBytes),
      r = await get(src, { accept: "*/*", text: /^(?!text\/html)/i, max: cap });
    jsBytes += r.over ? cap : Buffer.byteLength(r.body);
    if (r.over) {
      jsUnread++;
      continue;
    }
    const keys = [...new Set(secretsIn(r.body).map(k => `${k.label} (${k.shown})`))];
    if (keys.length)
      add(
        "secret-key-exposed",
        from.sort()[0],
        `in the script ${pathKey(src)}${from.length > 1 ? ` (loaded by ${from.length} pages)` : ""}: ${keys.join("; ")}`,
      );
  }
  if (jsUnread)
    notes.push(
      `${jsUnread} of the site's ${scripts.size} script files weren't read for secret keys, because of our own limits: ${JS_CAPS.files} files, ${JS_CAPS.each / 1048576} MB each and ${JS_CAPS.all / 1048576} MB in all. A key in one of them would be missed.`,
    );
  const apps = [];
  // Only the crawled origin is asked, and redirects aren't followed: neither file may be served through one.
  for (const [k, platform] of [
    ["android", "Android"],
    ["ios", "iOS"],
  ]) {
    const page = read
      .filter(p => p.hygieneSignals.app[k])
      .map(p => p.finalUrl)
      .sort()[0];
    if (!page) continue;
    let res = { status: 0, type: "", body: "" };
    try {
      const r = await fetch(START_ORIGIN + APP_FILES[k], {
        redirect: "manual",
        headers: { "user-agent": UA, accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      res = {
        status: r.status,
        type: r.headers.get("content-type") || "",
        body: r.status === 200 && r.body ? (await upTo(r.body, 1 << 18)).toString("utf8") : "",
      };
      if (r.status !== 200) await r.body?.cancel();
    } catch {}
    const bad = appFile(k, res);
    if (bad) apps.push({ platform, file: APP_FILES[k], page, ...bad });
  }
  if (apps.length) extra.appLinks = apps;
  // PDFs linked from a menu or PDF_PAGES+ indexable pages; Microsoft advises against relying on PDFs for core content.
  // https://about.ads.microsoft.com/en/blog/post/october-2025/optimizing-your-content-for-inclusion-in-ai-search-answers
  const pdfs = new Map(); // crawl URL -> { pages, menu }
  for (const p of read)
    if (indexable(p) && !p.clientOnly)
      for (const x of p.hygieneSignals.pdfs) {
        const e = pdfs.get(x) || pdfs.set(x, { pages: 0, menu: false }).get(x);
        e.pages++;
        e.menu ||= p.hygieneSignals.navPdfs.includes(x);
      }
  const listed = [...pdfs]
    .filter(([, e]) => e.menu || e.pages >= PDF_PAGES)
    .sort(([a, x], [b, y]) => Number(y.menu) - Number(x.menu) || y.pages - x.pages || a.localeCompare(b));
  if (listed.length)
    extra.pdfLinks = { count: listed.length, pdfs: listed.slice(0, 20).map(([url, e]) => ({ url, ...e })) };
}

// Compares the Markdown served for Accept: text/markdown with the page's words, on the render sample, only when the
// start page served Markdown (mdHome). Cloudflare's conversion drops header, footer and nav and appends the JSON-LD in
// a ```json block, so a converted copy still matches.
// https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/
// The half-the-words lines and the 50-word minimum are local; a few words would swing the share.
export async function markdownCheck(site, { mdHome, renderSample }) {
  const { byPage, add, start: START, get } = site;
  if (mdHome != null)
    for (const u of renderSample) {
      const p = byPage.get(u);
      if (!p?.markdownWords) continue;
      const res = u === START.href ? null : await get(u, { accept: "text/markdown", text: /^text\/markdown/i });
      const text = res ? (res.status === 200 && /^text\/markdown/i.test(res.ct) ? res.body : null) : mdHome;
      if (text == null) continue;
      const md = text
        .replace(/```json[\s\S]*?```|!\[[^\]]*\]\([^)]*\)|<[^>]*>|https?:\/\/\S+/g, " ")
        .replace(/\]\([^)]*\)/g, "]");
      const words = new Set(pickMainWords(md.replace(NOSPACE_RUN, " "))),
        main = p.markdownWords.main.split(" "),
        pageWords = new Set(p.markdownWords.all.split(" "));
      const kept = main.filter(w => words.has(w)).length / main.length,
        unseen = words.size ? [...words].filter(w => !pageWords.has(w)).length / words.size : 0;
      if (kept < 0.5 || unseen > 0.5)
        add(
          "markdown-differs",
          u,
          `the Markdown has ${Math.round(100 * kept)}% of the page's main words, and ${Math.round(100 * unseen)}% of its own words aren't on the page; our own limit is half`,
        );
    }
}
