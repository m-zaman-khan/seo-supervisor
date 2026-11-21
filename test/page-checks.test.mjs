// Links in user content, Back-button traps, paywalled text sent in full, late head tags and the site's identity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import {
  backTrap,
  identityDrift,
  lateHead,
  paywallLeak,
  ugcLinks,
} from "../skills/seo-supervisor/scripts/checks/page.mjs";

const COPY =
  "Our engineers fix leaks, radiators and hot water faults across the city every day of the week, with a clear written estimate before any work starts and a tidy finish afterwards. ".repeat(
    2,
  );
const words = n => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const ORG = {
  "@type": "Organization",
  "@id": "https://site.example/#organization",
  name: "Leeds Heating Co",
  url: "https://site.example/",
};
const SITE = {
  "@type": "WebSite",
  "@id": "https://site.example/#website",
  name: "Leeds Heating",
  publisher: { "@id": ORG["@id"] },
};
const ld = (...nodes) =>
  `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": nodes })}</script>`;
const page = (title, { head = "", body = "", graph = [ORG, SITE] } = {}) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${ld(...graph)}${head}</head><body><header><nav><a href="/">Home</a></nav></header><main><h1>${title}</h1><p>${COPY}</p>${body}</main><footer>Leeds Heating</footer></body></html>`;
async function crawlSite(pages) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  const site = await serve(dir);
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      site.url,
      "--site-origin",
      "https://site.example",
      "--out",
      out,
    ]);
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
const findingOf = (r, check) => r.findings.find(f => f.check === check);
const byPath = (r, check) =>
  Object.fromEntries((findingOf(r, check)?.evidence || []).map(e => [new URL(e.url).pathname, e.detail]));

// ---------- links in user content ----------
const WP_COMMENT = (link, rel = "") =>
  `<div id="comments" class="comments-area"><h2>2 comments</h2><ol class="comment-list"><li id="comment-7" class="comment even depth-1"><article id="div-comment-7" class="comment-body"><footer class="comment-meta"><a href="https://site.example/post/#comment-7">12 May</a></footer><div class="comment-content"><p>Thanks, see <a href="${link}"${rel}>this</a></p></div><div class="reply"><a rel="nofollow" class="comment-reply-link" href="#comment-7">Reply</a></div></article></li></ol></div>`;

test("ugcLinks: links in comment areas without ugc, nofollow or sponsored; other links, and qualified ones, aren't listed", () => {
  assert.deepEqual(
    ugcLinks(WP_COMMENT("https://spam.example/pills")),
    ["https://site.example/post/#comment-7", "https://spam.example/pills"],
    "every unqualified link in the area; the crawler keeps only other sites'",
  );
  for (const rel of [' rel="nofollow"', ' rel="ugc"', ' rel="external nofollow ugc"', " rel='sponsored'", ' rel="UGC"'])
    assert.ok(!ugcLinks(WP_COMMENT("https://spam.example/", rel)).includes("https://spam.example/"), rel);
  assert.deepEqual(
    ugcLinks(
      '<div itemscope itemtype="https://schema.org/Comment"><p>Try <a href="https://other.example/a?x=1&amp;y=2">it</a></p></div>',
    ),
    ["https://other.example/a?x=1&y=2"],
    "schema.org Comment microdata",
  );
  assert.deepEqual(
    ugcLinks('<article vocab="https://schema.org/" typeof="Comment"><a href="https://other.example/">x</a></article>'),
    ["https://other.example/"],
    "RDFa",
  );
  assert.deepEqual(
    ugcLinks(
      '<p>Our partner <a href="https://other.example/">site</a></p><div class="comment-count"><a href="https://other.example/c">3</a></div>',
    ),
    [],
    "links outside a comment area, and look-alike classes",
  );
  assert.deepEqual(
    ugcLinks(
      '<pre><code><span class="token comment">// see <a class="token url-link" href="https://other.example/">docs</a></span></code></pre>',
    ),
    [],
    "a highlighted code comment isn't user content",
  );
  assert.deepEqual(
    ugcLinks('<div id="comments"><p>Unclosed <a href="https://other.example/">x</a>'),
    [],
    "an area that isn't closed is skipped, never guessed",
  );
});

// ---------- Back-button hijacking ----------
const script = js => `<script>${js}</script>`;
test("backTrap: history changed on load with no click, plus a popstate handler that sends the visitor away", () => {
  assert.match(
    backTrap(
      script(
        'history.pushState(null, "", location.href); window.addEventListener("popstate", function () { location.href = "https://ads.example/offer"; });',
      ),
    ),
    /pushState/,
  );
  assert.match(
    backTrap(
      script(
        'history.replaceState({a:1},"");history.pushState({a:2},"");window.onpopstate=()=>{window.location.replace("/deals/")}',
      ),
    ),
    /replaceState|pushState/,
  );
  for (const [why, js] of [
    [
      "a router that changes history on click",
      'document.addEventListener("click", e => { history.pushState({}, "", e.target.href); render(); }); window.addEventListener("popstate", () => { location.href = location.pathname; });',
    ],
    [
      "popstate that only redraws the page",
      'history.replaceState(null, "", location.pathname); window.addEventListener("popstate", () => render(history.state));',
    ],
    ["tracking-parameter clean-up alone", 'history.replaceState(null, "", location.pathname);'],
    [
      "popstate that only changes the hash",
      'history.pushState(null, ""); addEventListener("popstate", () => { location.hash = "#top"; });',
    ],
  ])
    assert.equal(backTrap(script(js)), null, why);
  assert.equal(
    backTrap(
      '<script src="/app.js"></script><script type="application/ld+json">{"x":"history.pushState( popstate location.href = 1"}</script>',
    ),
    null,
    "only inline JavaScript is read",
  );
  assert.equal(
    backTrap(script('history.pushState(null,"");') + script('addEventListener("popstate",()=>{location.href="/x"})')),
    null,
    "both halves must be in one script",
  );
});

// ---------- paid text sent in full ----------
const paywalled = (
  part = { "@type": "WebPageElement", isAccessibleForFree: false, cssSelector: ".paywall" },
  free = false,
) => [{ "@type": "NewsArticle", headline: "x", isAccessibleForFree: free, hasPart: part }];
test("paywallLeak: 150 or more words inside the class hasPart names, on a page marked isAccessibleForFree false", () => {
  assert.deepEqual(paywallLeak(`<p>Free intro</p><div class="paywall">${words(200)}</div>`, paywalled()), {
    selector: ".paywall",
    words: 200,
  });
  assert.deepEqual(
    paywallLeak(
      `<div class="s1 body">${words(100)}</div><p>x</p><div class="s2">${words(60)}</div>`,
      paywalled([
        { "@type": "WebPageElement", isAccessibleForFree: "False", cssSelector: ".s1" },
        { "@type": "WebPageElement", isAccessibleForFree: false, cssSelector: [".s2"] },
      ]),
    ),
    { selector: ".s1, .s2", words: 160 },
    'sections add up; "False" as text counts',
  );
  assert.deepEqual(
    paywallLeak(`<div class="paywall"><div class="paywall">${words(160)}</div></div>`, paywalled()),
    { selector: ".paywall", words: 160 },
    "a nested element of the same class counts once",
  );
  assert.equal(paywallLeak(`<div class="paywall">${words(40)}</div>`, paywalled()), null, "a teaser");
  assert.equal(
    paywallLeak(`<div class="paywall">${words(200)}</div>`, paywalled(undefined, true)),
    null,
    "the page says it's free",
  );
  assert.equal(
    paywallLeak(
      `<div class="paywall">${words(200)}</div>`,
      paywalled({ "@type": "WebPageElement", isAccessibleForFree: true, cssSelector: ".paywall" }),
    ),
    null,
    "the part says it's free",
  );
  assert.equal(
    paywallLeak(
      `<div id="paid">${words(200)}</div>`,
      paywalled({ "@type": "WebPageElement", isAccessibleForFree: false, cssSelector: "#paid" }),
    ),
    null,
    "Google takes only .class selectors",
  );
  assert.equal(paywallLeak(`<div class="paywall-note">${words(200)}</div>`, paywalled()), null, "another class");
});

// ---------- head tags after </head> ----------
test("lateHead: title, description, canonical and robots tags sent after </head>", () => {
  assert.deepEqual(
    lateHead(
      '<html><head><meta charset="utf-8"></head><body><h1>x</h1><title>T</title><meta name="description" content="d"><link rel="canonical" href="/x"><meta name="robots" content="noindex"></body></html>',
    ),
    ["title", "description", "canonical", "robots"],
  );
  assert.deepEqual(
    lateHead('<html><head><title>T</title></head><body><meta name="googlebot" content="nosnippet"></body></html>'),
    ["robots"],
  );
  assert.deepEqual(
    lateHead(
      '<html><head><title>T</title><link rel="canonical" href="/x"></head><body><svg><title>Icon</title></svg><meta itemprop="description" content="d"><link itemprop="url" href="/y"><script>document.title="<title>x</title>"</script><!-- <title>old</title> --></body></html>',
    ),
    [],
    "an SVG title, microdata, scripts and comments",
  );
  assert.deepEqual(
    lateHead('<title>T</title><meta name="description" content="d"><p>No head or body tags</p>'),
    [],
    "no </head> or <body>: where the head ends can't be told",
  );
  assert.deepEqual(
    lateHead("<title>T</title><body><p>x</p><title>Again</title></body>"),
    ["title"],
    "the <body> tag ends the head when there's no </head>",
  );
});

// ---------- the site's identity (SCHEMA-02) ----------
test("identityDrift: an Organization or WebSite whose @id or name differs from the one most pages use", () => {
  const o = (id, name) => ({ id, name }),
    same = { org: [o("https://s/#org", "Acme")], site: [o("https://s/#web", "Acme")] };
  const drift = identityDrift([
    { url: "/", ...same },
    { url: "/a/", ...same },
    { url: "/b/", ...same },
    { url: "/name/", org: [o("https://s/#org", "Acme Ltd")], site: same.site },
    { url: "/id/", org: [o("https://s/#organization", "Acme")], site: [o("https://s#web", "Acme")] },
    { url: "/stub/", org: [o("https://s/#org", null)], site: [] },
    { url: "/partner/", org: [o("https://s/#org", "Acme"), o("https://partner/#org", "Partner Ltd")], site: same.site },
    { url: "/other/", org: [o("https://other/#org", "Other Ltd")], site: [] },
    { url: "/none/", org: [], site: [] },
  ]);
  assert.deepEqual(
    [...drift],
    [
      ["/name/", "Organization name “Acme Ltd” for https://s/#org, where other pages say “Acme”"],
      ["/id/", "Organization @id https://s/#organization, where other pages use https://s/#org"],
    ],
    "a stub that only references the @id, a second organization, an unrelated one and a page with none are fine; https://s#web is https://s/#web",
  );
  assert.deepEqual(
    [
      ...identityDrift([
        { url: "/", ...same },
        { url: "/x/", org: [o("https://s/#o2", "Acme")], site: [] },
      ]),
    ],
    [],
    "a tie: no value most pages use",
  );
  assert.deepEqual(
    [
      ...identityDrift([
        { url: "/", org: [o(null, "Acme")], site: [] },
        { url: "/a/", org: [o(null, "Acme")], site: [] },
        { url: "/b/", org: [o(null, "Acme Ltd")], site: [] },
      ]),
    ],
    [],
    "without @ids it can't tell one organization from two",
  );
});

// ---------- the crawl ----------
test("the crawl flags each check on its own page, at low severity under the owning rule, and the clean pages stay clean", async () => {
  const late = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${ld(ORG, SITE)}</head><body><main><h1>Boiler servicing prices</h1><p>${COPY}</p></main><title>Boiler servicing prices in Leeds</title><meta name="description" content="What a boiler service costs in Leeds."><link rel="canonical" href="https://site.example/late/"></body></html>`;
  const links = ["/ugc/", "/ugc-ok/", "/back/", "/spa/", "/paid/", "/teaser/", "/late/", "/name/"]
    .map(p => `<a href="${p}">Page ${p}</a>`)
    .join(" ");
  const r = await crawlSite({
    "/": page("Boiler repairs and servicing in Leeds", { body: links }),
    "/ugc/": page("Comments on boiler pressure", { body: WP_COMMENT("https://spam.example/pills") }),
    "/ugc-ok/": page("Comments on radiators", {
      body: `<p>See <a href="https://partner.example/">our partner</a>.</p>${WP_COMMENT("https://spam.example/", ' rel="nofollow ugc"')}<div id="comment-9"><a href="https://site.example/blog/">our blog</a></div>`,
    }),
    "/back/": page("Emergency plumber in Leeds", {
      head: script(
        'history.pushState(null, "", location.href); window.addEventListener("popstate", function () { location.href = "https://ads.example/"; });',
      ),
    }),
    "/spa/": page("Hot water faults", {
      head: script(
        'document.addEventListener("click", e => { if (e.target.matches("a")) { e.preventDefault(); history.pushState({}, "", e.target.href); } }); window.addEventListener("popstate", () => location.reload());',
      ),
    }),
    "/paid/": page("Heating market report 2026", {
      graph: [ORG, SITE, ...paywalled()],
      body: `<div class="paywall"><p>${words(300)}</p></div>`,
    }),
    "/teaser/": page("Heating market outlook", {
      graph: [ORG, SITE, ...paywalled()],
      body: `<div class="paywall"><p>${words(30)}</p></div>`,
    }),
    "/late/": late,
    "/name/": page("About Leeds Heating", { graph: [{ ...ORG, name: "Leeds Heating Company Ltd" }, SITE] }),
  });
  const expect = {
    "ugc-link-followed": ["CONTENT-11", "/ugc/", /1 link\(s\), e\.g\. https:\/\/spam\.example\/pills/],
    "back-button-trap": ["CONTENT-11", "/back/", /pushState/],
    "paywall-text-sent": ["REND-06", "/paid/", /about 300 words inside \.paywall/],
    "head-tags-late": ["REND-08", "/late/", /title, description, canonical/],
    "site-identity-differs": ["SCHEMA-02", "/name/", /“Leeds Heating Company Ltd”/],
  };
  for (const [check, [rule, path, detail]] of Object.entries(expect)) {
    const f = findingOf(r, check);
    assert.ok(f, check);
    assert.deepEqual([f.rule, f.severity, f.count], [rule, "low", 1], check);
    assert.deepEqual(Object.keys(byPath(r, check)), [path], check);
    assert.match(byPath(r, check)[path], detail, check);
  }
  const spam = r.notChecked.find(n => n.rule === "CONTENT-11");
  assert.match(spam.reason, /comment/i, "the not-checked reason names what the crawler now covers");
  assert.ok(
    !r.passed.some(p => p.rule === "CONTENT-11"),
    "the rest of the spam policies still can't be crawled, so it never passes",
  );
});
