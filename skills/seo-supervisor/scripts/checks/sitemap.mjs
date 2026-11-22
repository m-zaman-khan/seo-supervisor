// @ts-check
// Sitemap reading for the crawler, and the findings on the files and their entries.
import { attrs, decode, tagsOf } from "../lib/html.mjs";
import { clean } from "../crawl/fetch.mjs";

const SITEMAP_URLS = 50000; // the protocol's limit per file: Google reads no further
export const SITEMAP_KEEP = 200000;
const XML_TAG =
  /<([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_:][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|<\/([A-Za-z_][\w.:-]*)\s*>/y;
const BAD_ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/;
// Where a sitemap stops being well-formed XML ("line 3, column 37: why"), or null. A small scan of the declaration,
// tags, attributes, entities and single root, not a full parser: DTDs, namespaces and the schema aren't checked.
function xmlError(s) {
  const at = (i, why) =>
    `line ${(s.slice(0, i).match(/\n/g) || []).length + 1}, column ${i - s.lastIndexOf("\n", i - 1)}: ${why}`;
  const entity = (t, i) => {
    const k = t.search(BAD_ENTITY);
    if (k < 0) return null;
    const name = /^&[^\s&;<]{1,20};/.exec(t.slice(k))?.[0];
    return at(
      i + k,
      name ? `${name} isn't defined in XML (only &amp; &lt; &gt; &quot; &apos; are)` : "a bare & (write it as &amp;)",
    );
  };
  const HTML = "it's an HTML page, not a sitemap";
  const decl = s.search(/<\?xml[\s?]/);
  if (decl > 0) return at(decl, "there's text or a blank line before <?xml …?>, which has to come first");
  const stack = [];
  let i = 0,
    roots = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i),
      text = s.slice(i, lt < 0 ? s.length : lt);
    if (/\S/.test(text)) {
      if (!stack.length)
        return at(
          i + text.search(/\S/),
          roots ? "there's text after the last closing tag" : "there's text before the first tag",
        );
      const e = entity(text, i);
      if (e) return e;
    }
    if (lt < 0) break;
    const skip = [
      ["<!--", "-->", "a comment isn't closed with -->"],
      ["<![CDATA[", "]]>", "a CDATA section isn't closed with ]]>"],
      ["<?", "?>", "a <?…?> instruction isn't closed"],
    ].find(([open]) => s.startsWith(open, lt));
    if (skip) {
      const e = s.indexOf(skip[1], lt + skip[0].length);
      if (e < 0) return at(lt, skip[2]);
      i = e + skip[1].length;
      continue;
    }
    if (s.startsWith("<!", lt)) {
      if (/^<!doctype\s+html\b/i.test(s.slice(lt, lt + 20))) return at(lt, HTML);
      const e = s.indexOf(">", lt);
      if (e < 0) return at(lt, "a <!DOCTYPE> isn't closed");
      i = e + 1;
      continue;
    }
    XML_TAG.lastIndex = lt;
    const m = XML_TAG.exec(s);
    if (!m) return at(lt, `a broken tag: ${s.slice(lt, lt + 30).split("\n")[0]}…`);
    i = XML_TAG.lastIndex;
    if (m[4]) {
      const open = stack.pop();
      if (open !== m[4])
        return at(lt, open ? `</${m[4]}> where </${open}> was expected` : `</${m[4]}> has no opening tag`);
      continue;
    }
    const e = entity(m[2], lt + 1 + m[1].length);
    if (e) return e;
    if (!stack.length) {
      if (roots++) return at(lt, "a second root element after the first one closed");
      if (/^html$/i.test(m[1])) return at(lt, HTML);
    }
    if (!m[3]) stack.push(m[1]);
  }
  if (stack.length) return at(s.length, `the file ends before </${stack.at(-1)}>`);
  return roots ? null : at(0, "there are no XML tags in it");
}
// A tag's text (CDATA unwrapped), or undefined when it's missing or empty.
const tagText = (h, t) =>
  (h?.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ||
  undefined;
// listed is false for the guessed /sitemap.xml, where an HTML page means no sitemap. cut means SITEMAP_KEEP URLs were
// kept and the rest, with any files after them, went unread. toCrawl(url) maps the public origin onto the crawl.
/** @typedef {{ url: string, status: number, html?: boolean, invalid?: string, tooBig?: boolean, urls?: number, nestedIn?: string }} SitemapFile */
async function readSitemaps(urls, listed = true, { fetchSitemap, toCrawl }) {
  const entries = [],
    seen = new Set(),
    files = /** @type {SitemapFile[]} */ ([]);
  let cut = false;
  const queue = urls.map(u => [u, listed, null]); // [url, named, the sitemap index that lists it]
  while (queue.length && files.length < 60 && !cut) {
    const [u, named, parent] = queue.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    const r = await fetchSitemap(toCrawl(u)),
      body = r.body || "";
    if (r.status !== 200 || !(body.trim() || r.broken)) {
      files.push({ url: u, status: r.status });
      continue;
    }
    const file = { url: u, status: 200 };
    files.push(file);
    if (!named && /^\s*<(!doctype\s+html|html)\b/i.test(body)) {
      file.html = true;
      continue;
    }
    const bad = r.broken || (body.includes("<") && !r.tooBig && xmlError(body));
    if (bad) file.invalid = bad;
    if (r.tooBig) file.tooBig = true;
    // A text sitemap: one URL per line.
    if (!body.includes("<")) {
      const lines = body.split(/\s*\n\s*/).filter(l => /^https?:\/\/\S+$/.test(l));
      file.urls = lines.length;
      for (const l of lines.slice(0, SITEMAP_URLS)) {
        if (entries.length === SITEMAP_KEEP) {
          cut = true;
          break;
        }
        entries.push({ loc: l, lastmod: null, sitemap: u, hints: false });
      }
      continue;
    }
    // Search Console reports an index listed in another index as an error; its sitemaps are still read here.
    // No \s* around a lazy capture in these patterns: over a run of spaces with no closing tag it backtracks in cubic
    // time (32 KB takes hours); the value is trimmed afterwards instead.
    if (/<sitemapindex\b/i.test(body)) {
      if (parent) file.nestedIn = parent;
      for (const m of body.matchAll(/<sitemap\b[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi))
        queue.push([decode(m[1].trim()), true, u]);
      continue;
    }
    // Google accepts an RSS 2.0 or Atom 1.0 feed as a sitemap of recent URLs. An Atom entry's own link has rel
    // alternate or no rel. Feed dates (RFC 822 in RSS) aren't W3C dates, so lastmod is left out.
    // https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
    if (!/<urlset\b/i.test(body) && /<(rss|feed)\b/i.test(body)) {
      const locs = [
        ...[...body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(
          m => tagText(m[1], "link") && decode(tagText(m[1], "link")),
        ),
        ...[...body.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(
          m => tagsOf(m[1], "link").find(l => l.href && /^(alternate)?$/i.test((l.rel || "").trim()))?.href,
        ),
      ].filter(Boolean);
      file.urls = locs.length;
      for (const loc of locs.slice(0, SITEMAP_URLS)) {
        if (entries.length === SITEMAP_KEEP) {
          cut = true;
          break;
        }
        entries.push({ loc, lastmod: null, sitemap: u, hints: false });
      }
      continue;
    }
    file.urls = 0;
    const hasNews = body.includes("<news:news");
    for (const m of body.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
      // Past a file's 50,000 URLs, or the 200,000 kept in all, the rest is only counted, for sitemap-too-big.
      if (entries.length === SITEMAP_KEEP) cut = true;
      if (cut || file.urls === SITEMAP_URLS) {
        const rest = /<url\b/gi;
        rest.lastIndex = m.index;
        while (rest.exec(body)) file.urls++;
        break;
      }
      file.urls++;
      const loc = (m[1].match(/<loc>([\s\S]*?)<\/loc>/i) || [])[1]?.trim();
      const lastmod = (m[1].match(/<lastmod>([\s\S]*?)<\/lastmod>/i) || [])[1]?.trim();
      if (!loc) continue;
      const e = {
        loc: decode(loc),
        lastmod: lastmod || null,
        sitemap: u,
        hints: /<(priority|changefreq)>/i.test(m[1]),
      };
      // Google News entries: the tags Google requires, and the first-published date.
      const news = hasNews ? tagText(m[1], "news:news") : undefined,
        pub = tagText(news, "news:publication");
      if (news)
        e.news = {
          date: tagText(news, "news:publication_date"),
          missing: ["news:publication", "news:name", "news:language", "news:publication_date", "news:title"].filter(
            t => !tagText(t === "news:name" || t === "news:language" ? pub : news, t),
          ),
        };
      // Each <video:video> needs a thumbnail, title, description (2,048 characters at most) and a content or player
      // URL; each <image:image> needs <image:loc>, and a page may list 1,000 images at most.
      if (m[1].includes("<video:video"))
        e.videos = [...m[1].matchAll(/<video:video\b[^>]*>([\s\S]*?)<\/video:video>/g)].map(([, v]) =>
          [
            ...["video:thumbnail_loc", "video:title", "video:description"]
              .filter(t => !tagText(v, t))
              .map(t => `no <${t}>`),
            tagText(v, "video:description")?.length > 2048 && "a description over 2,048 characters",
            !tagText(v, "video:content_loc") &&
              !tagText(v, "video:player_loc") &&
              "no <video:content_loc> or <video:player_loc>",
          ].filter(Boolean),
        );
      if (m[1].includes("<image:image")) {
        const imgs = [...m[1].matchAll(/<image:image\b[^>]*\/>|<image:image\b[^>]*>([\s\S]*?)<\/image:image>/g)];
        e.images = { count: imgs.length, noLoc: imgs.filter(x => !tagText(x[1], "image:loc")).length };
      }
      // hreflang alternates (<xhtml:link rel="alternate" hreflang href>), which Google reads here as in the HTML.
      if (/<[\w.-]+:link\b/.test(m[1]))
        e.hreflang = [...m[1].matchAll(/<[\w.-]+:link\b[^>]*>/g)]
          .map(t => attrs(t[0]))
          .filter(a => (a.rel || "").toLowerCase().split(/\s+/).includes("alternate") && a.hreflang && a.href)
          .map(a => ({ lang: a.hreflang, href: a.href }));
      // A page listed again in an image, video or news sitemap isn't a duplicate.
      e.media = !!(e.news || e.videos || e.images);
      entries.push(e);
    }
  }
  // Files still queued after the 60-file limit went unread too, so pages in them can't be called missing.
  const filesLeft = !cut && queue.some(([u]) => !seen.has(u));
  return { entries, files, cut: cut || filesLeft, filesLeft };
}

// smUrls are robots.txt's sitemaps (smListed) or the guessed /sitemap.xml; the usual index names follow if they list
// nothing.
export async function findSitemaps(smUrls, smListed, { startOrigin: START_ORIGIN, notes, fetchSitemap, toCrawl }) {
  const io = { fetchSitemap, toCrawl };
  let sm = await readSitemaps(smUrls, smListed, io);
  // The plugins' index names, then WordPress core's (since 5.5), and /sitemap.xml when robots.txt named other files: a
  // stale Sitemap: line left after a move mustn't hide the real sitemap. The named files stay in files, so a broken one
  // is still reported.
  for (const path of ["/sitemap_index.xml", "/sitemap-index.xml", "/wp-sitemap.xml"]) {
    if (sm.entries.length || smListed) break;
    const alt = await readSitemaps([START_ORIGIN + path], false, io);
    if (alt.entries.length) sm = alt;
  }
  if (sm.filesLeft)
    notes.push(
      "The sitemap index lists more than 60 sitemap files. Only the first 60 were read, so the URLs in the rest weren't checked.",
    );
  else if (sm.cut)
    notes.push(
      `The sitemaps list more than ${SITEMAP_KEEP.toLocaleString("en-US")} URLs. Only the first ${SITEMAP_KEEP.toLocaleString("en-US")} were read, so the rest, and any sitemap files after them, weren't checked.`,
    );
  return sm;
}

// Findings on the sitemap files themselves, and a missing sitemap.
export function checkSitemapFiles(sm, smUrls, { add, findings }) {
  for (const f of sm.files) {
    if (f.invalid) add("sitemap-invalid", f.url, f.invalid);
    if (f.tooBig || f.urls > 50000)
      add("sitemap-too-big", f.url, f.tooBig ? "over 50 MB uncompressed" : `${f.urls.toLocaleString("en-US")} URLs`);
    if (f.nestedIn) add("sitemap-index-nested", f.url, `listed in ${f.nestedIn}`);
  }
  if (!sm.entries.length && !findings.has("sitemap-invalid"))
    add(
      "sitemap-missing",
      smUrls.join(", "),
      sm.files.map(f => `${f.url} → ${f.status}${f.html ? ", an HTML page" : ""}`).join("; ") || undefined,
    );
}

// Runs once the public origin (expectOrigin) is settled. Entries on the crawled site go straight into the crawl queue,
// as a sitemap lists pages, not links. firstSm, the first sitemap URL, carries the site-wide lastmod finding.
export function checkSitemapEntries(
  sm,
  firstSm,
  {
    add,
    notes,
    evalRules,
    expectOrigin: EXPECT_ORIGIN,
    startOrigin: START_ORIGIN,
    toCrawl,
    inSection,
    crawler: { seen, queue },
  },
) {
  const smSet = new Map(); // crawl URL -> entry
  evalRules("MAP-02", "MAP-04");
  // Google asks to keep session IDs out of URLs: the common names and ASP.NET's (S(…)) path form.
  // https://developers.google.com/search/docs/crawling-indexing/url-structure
  const SESSION_ID =
    /[;?&](?:jsessionid|phpsessid|sessionid|session_id|sessid|aspsessionid[a-z]*|cftoken)=[^&#;]*|\/\(S\([a-z0-9]+\)\)/i;
  for (const e of sm.entries) {
    // A <loc> must be under 2,048 characters, and Google ignores #fragments. https://www.sitemaps.org/protocol.html
    if (e.loc.length >= 2048)
      add(
        "sitemap-url-too-long",
        e.sitemap,
        `${e.loc.slice(0, 80)}… (${e.loc.length.toLocaleString("en-US")} characters)`,
      );
    const sid = SESSION_ID.exec(e.loc)?.[0];
    if (sid || e.loc.includes("#")) add("sitemap-session-ids", e.loc, sid ? `session ID ${sid}` : "a #fragment");
    let o;
    try {
      o = new URL(e.loc).origin;
    } catch {
      continue;
    }
    if (o !== EXPECT_ORIGIN) add("sitemap-origin", e.loc, `expected ${EXPECT_ORIGIN}`);
    const c = clean(toCrawl(e.loc));
    if (!c) continue;
    smSet.set(c, e);
    if (new URL(c).origin === START_ORIGIN && !seen.has(c) && inSection(new URL(c).pathname)) {
      seen.add(c);
      queue.push(c);
    }
  }
  const lm = sm.entries.map(e => (e.lastmod || "").slice(0, 10)).filter(Boolean);
  if (lm.length >= 5 && new Set(lm).size === 1)
    add("sitemap-lastmod-same", firstSm, `all ${lm.length} entries: ${lm[0]}`);
  // Per file: lastmod after tomorrow (a day of slack for time zones) or not a W3C date, and tags Google ignores.
  const W3C_DATE =
    /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01])(T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d))?)?)?$/;
  // The regex allows 2026-02-30; a real day survives the round trip through Date.
  const realDay = s => {
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    return !d || new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
  };
  const validLastmod = s => W3C_DATE.test(s) && realDay(s);
  const bySitemap = new Map();
  for (const e of sm.entries) (bySitemap.get(e.sitemap) || bySitemap.set(e.sitemap, []).get(e.sitemap)).push(e);
  // The same URL twice in one file or in two regular sitemaps; a media or news entry for a listed page is fine.
  const plainIn = new Map(),
    inFile = new Set(),
    dupes = new Map(); // URL -> first regular file; "file URL"; file -> [[URL, other file]]
  for (const e of sm.entries) {
    const key = `${e.sitemap} ${e.loc}`,
      other = inFile.has(key) ? e.sitemap : !e.media && plainIn.get(e.loc);
    inFile.add(key);
    if (!e.media && !plainIn.has(e.loc)) plainIn.set(e.loc, e.sitemap);
    if (other) (dupes.get(e.sitemap) || dupes.set(e.sitemap, []).get(e.sitemap)).push([e.loc, other]);
  }
  for (const [file, ds] of dupes)
    add(
      "sitemap-duplicate-urls",
      file,
      `${ds.length.toLocaleString("en-US")} URL(s) listed more than once, e.g. ${ds[0][0]} ${ds[0][1] === file ? "twice in this file" : `(also in ${ds[0][1]})`}`,
    );
  for (const [file, es] of bySitemap) {
    const videos = es.flatMap(e => (e.videos || []).map(missing => ({ loc: e.loc, missing }))),
      badVideos = videos.filter(v => v.missing.length);
    if (badVideos.length)
      add(
        "video-sitemap-tags",
        file,
        `${badVideos.length} of ${videos.length} videos, e.g. ${badVideos[0].loc}: ${badVideos[0].missing.join(", ")}`,
      );
    const pictured = es.filter(e => e.images),
      badImages = pictured.filter(e => e.images.noLoc || e.images.count > 1000);
    if (badImages.length) {
      const { loc, images: i } = badImages[0];
      add(
        "image-sitemap-tags",
        file,
        `${badImages.length} of ${pictured.length} pages with images, e.g. ${loc}: ${[i.noLoc && `${i.noLoc} <image:image> without <image:loc>`, i.count > 1000 && `${i.count.toLocaleString("en-US")} images (1,000 at most)`].filter(Boolean).join(", ")}`,
      );
    }
    const dated = es.filter(e => e.lastmod),
      eg = list => `${list.length} of ${es.length} entries, e.g. ${list[0].loc}: ${list[0].lastmod}`;
    const invalid = dated.filter(e => !validLastmod(e.lastmod)),
      future = dated.filter(e => validLastmod(e.lastmod) && Date.parse(e.lastmod) > Date.now() + 864e5);
    if (future.length) add("sitemap-lastmod-future", file, eg(future));
    if (invalid.length) add("sitemap-lastmod-invalid", file, eg(invalid));
    // <priority> and <changefreq> are ignored, not harmful, so a note rather than a finding.
    const hinted = es.filter(e => e.hints).length;
    if (hinted)
      notes.push(
        `${file}: ${hinted} of ${es.length} entries use <priority> or <changefreq>. Google and Bing ignore both, so they can go when the sitemap code is next touched; an accurate lastmod is the signal that counts.`,
      );
    // A news sitemap, per Google's rules: the required tags, a full W3C date, articles from the last two days (a day
    // of slack for time zones and date-only values), and at most 1,000 of them.
    const news = es.filter(e => e.news);
    if (!news.length) continue;
    const say = (list, what) => `${list.length} of ${news.length} articles, e.g. ${list[0].loc}: ${what(list[0].news)}`;
    const newsDate = d => !!d && d.length >= 10 && validLastmod(d);
    const untagged = news.filter(e => e.news.missing.length || !newsDate(e.news.date)),
      old = news.filter(e => newsDate(e.news.date) && Date.parse(e.news.date) < Date.now() - 3 * 864e5);
    if (untagged.length)
      add(
        "news-sitemap-tags",
        file,
        say(untagged, n =>
          n.missing.length
            ? `no ${n.missing.map(t => `<${t}>`).join(", ")}`
            : `publication date “${n.date}” isn't a W3C date such as 2026-11-17 or 2026-11-17T10:30:00+00:00`,
        ),
      );
    if (old.length)
      add(
        "news-sitemap-old",
        file,
        say(old, n => n.date),
      );
    if (news.length > 1000) add("news-sitemap-too-many", file, `${news.length.toLocaleString("en-US")} articles`);
  }
  return smSet;
}
