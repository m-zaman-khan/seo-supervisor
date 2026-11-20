import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { checkOutbound, CHECKS as OUTBOUND_CHECKS } from "../skills/seo-supervisor/scripts/checks/outbound.mjs";
import { cookieProblems, CHECKS } from "../skills/seo-supervisor/scripts/checks/technical.mjs";

// Pages ({ "/path/": html }) and sitemaps ({ "/file.xml": xml body }; the top-level ones are listed in robots.txt),
// crawled as https://example.com. headers: response headers by path; args go to the crawler.
async function crawl(pages, { sitemaps = {}, listed = Object.keys(sitemaps), headers, args = [] } = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(
    join(dir, "robots.txt"),
    `User-agent: *\nAllow: /\n${listed.map(p => `Sitemap: https://example.com${p}\n`).join("")}`,
  );
  const files = Object.fromEntries(
    Object.entries(sitemaps).map(([p, body]) => [
      p,
      { type: "application/xml", body: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${body}`) },
    ]),
  );
  const site = await serve(dir, { files, headers });
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      site.url,
      "--site-origin",
      "https://example.com",
      "--out",
      out,
      ...args,
    ]);
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
const NS =
  ' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"';
const urlset = entries =>
  `<urlset${NS}>${entries.map(e => (e.startsWith("<") ? e : `<url><loc>https://example.com${e}</loc></url>`)).join("")}</urlset>`;
const index = files =>
  `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files.map(f => `<sitemap><loc>https://example.com${f}</loc></sitemap>`).join("")}</sitemapindex>`;
const page = (title, body = "", head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="What ${title} is about."><meta property="og:title" content="${title}">${head}</head><body><main><h1>${title}</h1>${body}</main></body></html>`;
const img = (src, attrs = "") => `<img src="${src}" width="400" height="300" alt=""${attrs ? " " + attrs : ""}>`;
const NAV = '<a href="/images/">Images</a> <a href="/meta/">Meta</a>';
const LONG = "https://example.com/images/?q=" + "a".repeat(2100);

// One planted problem per check, on the pages and sitemaps named in the tests below.
let badRun, goodRun;
const bad = () =>
  (badRun ||= crawl(
    {
      "/": page(
        "Home",
        `${NAV} <a href="/my page/">My page</a> <a href="/café/">Café</a><script>document.cookie = "tracker=1"</script>`,
      ),
      "/images/": page(
        "Images",
        img("/hero.jpg", 'width="1600" height="900"').replace('width="400" height="300" ', "") +
          Array.from({ length: 12 }, (_, i) => img(`/i${i + 1}.jpg`)).join(""),
      ),
      "/meta/": page(
        "Meta",
        "<h2>250+</h2><p>boilers fitted</p>",
        '<meta name="description" content="A second description."><meta name="viewport" content="width=device-width"><meta property="og:title" content="Again"><meta name="referrer" content="unsafe-url">',
      ),
    },
    {
      sitemaps: {
        "/sitemap.xml": urlset([
          "/",
          "/",
          "/meta/;jsessionid=ABC123",
          "/meta/#reviews",
          `<url><loc>${LONG}</loc></url>`,
          "<url><loc>https://example.com/images/</loc><video:video><video:thumbnail_loc>https://example.com/t.jpg</video:thumbnail_loc><video:description>Fitting a boiler</video:description></video:video><image:image><image:caption>No address</image:caption></image:image></url>",
        ]),
        "/index.xml": index(["/nested.xml"]),
        "/nested.xml": index(["/leaf.xml"]),
        "/leaf.xml": urlset(["/meta/", "/"]),
      },
      listed: ["/sitemap.xml", "/index.xml"],
      headers: {
        "/": {
          "Strict-Transport-Security": "max-age=86400",
          "Referrer-Policy": "no-referrer, unsafe-url",
          "Set-Cookie": ["session=abc; Path=/", "prefs=dark; Path=/; HttpOnly; SameSite=Lax"],
        },
        "/sitemap.xml": { "Set-Cookie": "xmlcookie=1; Path=/" },
      },
    },
  ));
// The same kinds of things done right, and the look-alikes that are fine.
const good = () =>
  (goodRun ||= crawl(
    {
      "/": page(
        "Home",
        `${NAV} <a href="/caf%C3%A9/">Café</a> <a href=" /images/ ">Images again</a> <a href="https://bücher.example/">Books</a><script>document.cookie = "consent=yes"</script>`,
      ),
      "/images/": page(
        "Images",
        [
          '<img src="/hero.jpg" width="1600" height="900" srcset="/hero-800.jpg 800w, /hero.jpg 1600w" sizes="100vw" alt="">',
          '<picture><source srcset="/wide.avif" type="image/avif"><img src="/wide.jpg" width="1600" height="900" alt=""></picture>',
          '<img src="/logo.svg" width="1200" height="300" alt="">',
          ...Array.from({ length: 7 }, (_, i) => img(`/i${i + 1}.jpg`)),
          img("/i8.jpg", 'loading="lazy"'),
          '<img src="data:image/gif;base64,R0lGOD" data-src="/i9.jpg" class="lazyload" width="400" height="300" alt="">',
          '<img src="/icon.png" width="24" height="24" alt="">',
          img("/i10.jpg", 'loading="eager"'),
        ].join(""),
      ),
      "/meta/": page(
        "Meta",
        "<h2>10 tips for boilers</h2><h2>2026</h2><h2>24/7 support</h2>",
        '<meta property="og:image" content="https://example.com/a.png"><meta property="og:image" content="https://example.com/b.png"><meta name="googlebot" content="index">',
      ),
    },
    {
      sitemaps: {
        "/index.xml": index(["/pages.xml", "/images.xml", "/video.xml"]),
        "/pages.xml": urlset(["/", "/images/", "/meta/", "/images/?q=short"]),
        "/images.xml": urlset([
          "<url><loc>https://example.com/</loc><image:image><image:loc>https://example.com/i1.jpg</image:loc></image:image></url>",
        ]),
        "/video.xml": urlset([
          "<url><loc>https://example.com/images/</loc><video:video><video:thumbnail_loc>https://example.com/t.jpg</video:thumbnail_loc><video:title>Fitting a boiler</video:title><video:description>How we fit a boiler</video:description><video:player_loc>https://www.example.com/player?v=1</video:player_loc></video:video></url>",
        ]),
      },
      listed: ["/index.xml"],
      headers: {
        "/": {
          "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
          "Referrer-Policy": "unsafe-url, strict-origin-when-cross-origin",
          "Set-Cookie": [
            "session=abc; Path=/; Secure; HttpOnly; SameSite=Lax",
            "XSRF-TOKEN=x; Path=/; SameSite=Lax",
            "old=; Path=/; Max-Age=0",
          ],
        },
      },
    },
  ));
const finding = (r, check) => r.findings.find(f => f.check === check);
// The evidence by path ("/meta/") or, for a sitemap URL, by its file name; the detail as the value.
const evidence = (r, check) =>
  Object.fromEntries((finding(r, check)?.evidence || []).map(e => [new URL(e.url).pathname, e.detail]));
const assertNone = (r, checks) => {
  for (const c of checks)
    assert.ok(!finding(r, c), `${c} on the normal site: ${JSON.stringify(finding(r, c)?.evidence)}`);
};
const rule = (r, check) => [finding(r, check)?.rule, finding(r, check)?.severity];

test("every technical and outbound-link check has a rule, a severity, a title, a why and a fix", () => {
  for (const [key, [r, sev, title, why, fix]] of Object.entries({ ...CHECKS, ...OUTBOUND_CHECKS })) {
    assert.match(r, /^[A-Z]+-\d\d$/, key);
    assert.equal(sev, "low", key);
    assert.ok(title(2) && why && fix, key);
  }
});

test("sitemaps: duplicate URLs, a nested index, video and image entries without their required tags, session IDs, fragments and URLs over 2,048 characters", async () => {
  const [r, ok] = await Promise.all([bad(), good()]);
  const dup = evidence(r, "sitemap-duplicate-urls");
  assert.deepEqual(rule(r, "sitemap-duplicate-urls"), ["MAP-01", "low"]);
  assert.deepEqual(Object.keys(dup).sort(), ["/leaf.xml", "/sitemap.xml"]);
  assert.match(dup["/sitemap.xml"], /https:\/\/example\.com\/ .*twice in this file/);
  assert.match(dup["/leaf.xml"], /also in https:\/\/example\.com\/sitemap\.xml/);
  assert.deepEqual(rule(r, "sitemap-index-nested"), ["MAP-01", "low"]);
  assert.deepEqual(evidence(r, "sitemap-index-nested"), { "/nested.xml": "listed in https://example.com/index.xml" });
  assert.equal(
    r.stats.sitemapUrls,
    8,
    "the nested index's sitemaps are still read, so the other checks see their URLs",
  );
  assert.deepEqual(rule(r, "video-sitemap-tags"), ["MAP-01", "low"]);
  assert.match(
    evidence(r, "video-sitemap-tags")["/sitemap.xml"],
    /^1 of 1 videos, e\.g\. https:\/\/example\.com\/images\/: no <video:title>, no <video:content_loc> or <video:player_loc>$/,
  );
  assert.deepEqual(rule(r, "image-sitemap-tags"), ["MAP-01", "low"]);
  assert.match(
    evidence(r, "image-sitemap-tags")["/sitemap.xml"],
    /^1 of 1 pages with images, e\.g\. https:\/\/example\.com\/images\/: 1 <image:image> without <image:loc>$/,
  );
  assert.deepEqual(rule(r, "sitemap-session-ids"), ["MAP-02", "low"]);
  assert.deepEqual(Object.values(evidence(r, "sitemap-session-ids")).sort(), [
    "a #fragment",
    "session ID ;jsessionid=ABC123",
  ]);
  assert.deepEqual(rule(r, "sitemap-url-too-long"), ["MAP-02", "low"]);
  assert.equal(finding(r, "sitemap-url-too-long").count, 1);
  assert.match(
    evidence(r, "sitemap-url-too-long")["/sitemap.xml"],
    /^https:\/\/example\.com\/images\/\?q=a+… \(2,130 characters\)$/,
  );
  // An image or video sitemap listing a page the regular sitemap lists too is normal, and so is a complete entry.
  assertNone(ok, [
    "sitemap-duplicate-urls",
    "sitemap-index-nested",
    "video-sitemap-tags",
    "image-sitemap-tags",
    "sitemap-session-ids",
    "sitemap-url-too-long",
  ]);
  for (const c of ["MAP-01", "MAP-02"])
    assert.ok(
      ok.passed.some(p => p.rule === c),
      c,
    );
});

test("URLs: links with spaces or non-ASCII letters left unencoded are flagged; encoded ones, spaces around the address and non-ASCII host names aren't", async () => {
  const [r, ok] = await Promise.all([bad(), good()]);
  assert.deepEqual(rule(r, "url-unencoded"), ["URL-01", "low"]);
  assert.deepEqual(evidence(r, "url-unencoded"), { "/": "2 link(s), e.g. /my page/, /café/" });
  assertNone(ok, ["url-unencoded"]);
});

test("images: wide images without srcset, and images far down the page without lazy loading; srcset, <picture>, SVG, lazy, script-loaded, tiny and eager images pass", async () => {
  const [r, ok] = await Promise.all([bad(), good()]);
  assert.deepEqual(rule(r, "img-no-srcset"), ["PERF-08", "low"]);
  assert.deepEqual(evidence(r, "img-no-srcset"), {
    "/images/": "1 image(s) over 1,000 px wide, e.g. /hero.jpg (1600 px)",
  });
  assert.deepEqual(rule(r, "img-not-lazy"), ["PERF-03", "low"]);
  assert.deepEqual(evidence(r, "img-not-lazy"), { "/images/": "3 image(s) from the 11th on, e.g. /i10.jpg" });
  assertNone(ok, ["img-no-srcset", "img-not-lazy"]);
});

test("pages: two descriptions, viewports or og:titles, and headings that are only a number; several og:images, years and headings with words pass", async () => {
  const [r, ok] = await Promise.all([bad(), good()]);
  assert.deepEqual(rule(r, "duplicate-head-tags"), ["META-03", "low"]);
  assert.deepEqual(evidence(r, "duplicate-head-tags"), { "/meta/": "2 × description, 2 × viewport, 2 × og:title" });
  assert.deepEqual(rule(r, "heading-only-number"), ["CONTENT-02", "low"]);
  assert.deepEqual(evidence(r, "heading-only-number"), { "/meta/": "H2 “250+”" });
  assertNone(ok, ["duplicate-head-tags", "heading-only-number"]);
  assert.ok(
    !r.passed.some(p => p.rule === "META-03"),
    "without --brand META-03 can fail on duplicate tags but isn't passed",
  );
});

test("security: HSTS under a year, Referrer-Policy unsafe-url (the last valid value counts) and cookies without HttpOnly or SameSite", async () => {
  const [r, ok] = await Promise.all([bad(), good()]);
  for (const c of ["hsts-short", "referrer-unsafe", "cookie-flags"])
    assert.deepEqual(rule(r, c), ["TRUST-01", "low"], c);
  assert.deepEqual(evidence(r, "hsts-short"), { "/": "max-age=86400 (1 day)" });
  assert.deepEqual(evidence(r, "referrer-unsafe"), {
    "/": "header: no-referrer, unsafe-url",
    "/meta/": "meta: unsafe-url",
  });
  assertNone(ok, ["hsts-short", "referrer-unsafe", "cookie-flags"]);
});

test("cookies set by scripts aren't checked; Set-Cookie headers are", async () => {
  const [r, ok] = await Promise.all([bad(), good()]);
  const f = finding(r, "cookie-flags");
  assert.equal(f.count, 1, JSON.stringify(f.evidence));
  assert.deepEqual(evidence(r, "cookie-flags"), { "/": "“session”: no HttpOnly, no SameSite" });
  assert.doesNotMatch(
    JSON.stringify(f),
    /tracker|xmlcookie|prefs/,
    "script cookies, cookies on other responses and well-set cookies aren't listed",
  );
  assert.ok(!finding(ok, "cookie-flags"), "a CSRF token scripts must read, and a cookie being deleted, aren't flagged");
  // Secure is judged only on an HTTPS response: a local dev server leaves it off on purpose.
  assert.deepEqual(cookieProblems("session=abc; Path=/; HttpOnly; SameSite=Lax", { https: true }), ["no Secure"]);
  assert.deepEqual(cookieProblems("session=abc; Path=/; HttpOnly; SameSite=Lax", { https: false }), []);
  assert.deepEqual(cookieProblems("__Host-id=1; Path=/; secure; httponly; samesite=strict", { https: true }), []);
  assert.deepEqual(cookieProblems("csrftoken=x; Path=/; Secure; SameSite=Lax", { https: true }), []);
  assert.deepEqual(cookieProblems("gone=; Expires=Thu, 01 Jan 1970 00:00:00 GMT", { https: true }), []);
});

// One local server plays another site: hits counts every request it gets.
async function otherSite(answer) {
  const hits = [];
  const srv = await serve(tmp(), {
    before(req, res) {
      hits.push(`${req.method} ${req.url}`);
      return answer ? answer(req, res) : false;
    },
  });
  return { ...srv, hits };
}

test("without --outbound-links no outside request is made; with it, private addresses are still refused", async () => {
  const other = await otherSite();
  try {
    const pages = {
      "/": page("Home", `<a href="${other.url}/guide">A guide elsewhere</a> <a href="https://example.com/">Home</a>`),
    };
    const [off, on] = [await crawl(pages), await crawl(pages, { args: ["--outbound-links"] })];
    assert.deepEqual(other.hits, [], "the other site is never contacted from a local crawl");
    assert.match(off.notChecked.find(n => /Links to other sites/.test(n.area))?.reason || "", /--outbound-links/);
    assert.equal(off.outboundLinks, undefined);
    assert.deepEqual(on.outboundLinks.broken, []);
    assert.deepEqual(
      on.outboundLinks.unreachable.map(u => u.url),
      [`${other.url}/guide`],
      "the site's own public origin isn't an outside link",
    );
    assert.match(on.outboundLinks.unreachable[0].reason, /isn't a public web address/);
    assert.ok(!on.notChecked.some(n => /Links to other sites/.test(n.area)));
    assert.ok(
      on.notes.some(n => /1 link\(s\) to other sites couldn't be checked/.test(n)),
      on.notes.join("\n"),
    );
  } finally {
    await other.close();
  }
});

const anyAddress = { allow: async () => true };

test("outbound links: 404 and 410 are broken; a HEAD refused but a GET answered is fine; 403, 500 and no answer are couldn't check", async () => {
  const other = await otherSite((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const status = { "/gone": 404, "/removed": 410, "/blocked": 403, "/error": 500 }[path];
    if (status) {
      res.writeHead(status).end();
      return true;
    }
    if (path === "/no-head") {
      res.writeHead(req.method === "HEAD" ? 405 : 200).end();
      return true;
    }
    if (path === "/moved") {
      res.writeHead(301, { Location: "/fine" }).end();
      return true;
    }
    if (path === "/fine") {
      res.writeHead(200, { "Content-Type": "text/html" }).end("<p>hi</p>");
      return true;
    }
    return path === "/slow"; // never answers
  });
  try {
    const u = p => other.url + p;
    const r = await checkOutbound(["/gone", "/removed", "/no-head", "/moved", "/blocked", "/error", "/slow"].map(u), {
      ...anyAddress,
      timeout: 500,
    });
    assert.deepEqual(r.broken, [
      { url: u("/gone"), status: 404 },
      { url: u("/removed"), status: 410 },
    ]);
    assert.deepEqual(
      r.unreachable.map(x => x.url),
      [u("/blocked"), u("/error"), u("/slow")],
    );
    assert.match(r.unreachable[0].reason, /answered 403/);
    assert.match(r.unreachable[2].reason, /no answer within 0\.5 seconds/);
    assert.ok(
      other.hits.includes("HEAD /gone") && other.hits.includes("GET /gone"),
      "a 404 to HEAD is asked again with GET before it counts",
    );
    assert.ok(!other.hits.includes("GET /fine"), "a page that answers HEAD isn't downloaded");
    assert.ok(!other.hits.some(h => h.startsWith("GET /slow")), "a page that didn't answer isn't asked again");
  } finally {
    await other.close();
  }
});

test("outbound links: at most 100 distinct URLs, 4 at a time", async () => {
  let now = 0,
    most = 0;
  const other = await otherSite((req, res) => {
    most = Math.max(most, ++now);
    setTimeout(() => {
      now--;
      res.writeHead(200).end();
    }, 20);
    return true;
  });
  try {
    const urls = Array.from({ length: 105 }, (_, i) => `${other.url}/p${i}`);
    const r = await checkOutbound([...urls, urls[0]], anyAddress);
    assert.deepEqual([r.broken, r.unreachable], [[], []]);
    assert.equal(new Set(other.hits).size, 100);
    assert.ok(!other.hits.some(h => / \/p10[0-4]$/.test(h)));
    assert.equal(most, 4);
  } finally {
    await other.close();
  }
});

test("outbound links: private and local addresses are refused, also after a redirect", async () => {
  const other = await otherSite((req, res) => {
    res.writeHead(302, { Location: "http://10.0.0.1/admin" }).end();
    return true;
  });
  try {
    const local = await checkOutbound([
      `${other.url}/a`,
      "http://localhost/",
      "http://intranet/",
      "http://192.168.1.1/",
    ]);
    assert.equal(local.unreachable.length, 4);
    assert.ok(local.unreachable.every(u => /isn't a public web address/.test(u.reason)));
    assert.deepEqual(other.hits, [], "nothing private is contacted");
    const hop = await checkOutbound([`${other.url}/a`], { allow: async u => u.startsWith(other.url) });
    assert.match(
      hop.unreachable[0].reason,
      /redirects to http:\/\/10\.0\.0\.1\/admin, which isn't a public web address/,
    );
    // A public name that resolves to a private address is refused when connecting (DNS rebinding).
    const rebind = await checkOutbound(["http://looks-public.example/"], {
      allow: async () => true,
      dns: (name, opts, cb) => cb(null, [{ address: "127.0.0.1", family: 4 }]),
    });
    assert.match(rebind.unreachable[0].reason, /private or local address/);
  } finally {
    await other.close();
  }
});
