// Google rich results: required properties, retired types, the snippets, desktop speed, speed trends and page types.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { checkJsonLd } from "../skills/seo-supervisor/scripts/schema-check.mjs";
import { band } from "../skills/seo-supervisor/scripts/checks/speed.mjs";
import { diffCrawls } from "../skills/seo-supervisor/scripts/seo-diff.mjs";
import { ROOT, SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";

const DATA = JSON.parse(readFileSync(join(SCRIPTS, "data", "google-rich-results.json"), "utf8"));
const VOCAB = JSON.parse(readFileSync(join(SCRIPTS, "data", "schema-vocab.json"), "utf8"));
const CTX = { "@context": "https://schema.org" };
const label = x =>
  []
    .concat(x)
    .map(k => `"${k}"`)
    .join(" or ");
const retiredIn = o => checkJsonLd(JSON.stringify({ ...CTX, ...o })).filter(i => i.check === "type-retired");

test("every supported type in google-rich-results.json has its required properties checked, and every retired type is flagged as retired", () => {
  assert.match(DATA.checked, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(DATA.source, "https://developers.google.com/search/docs/appearance/structured-data/search-gallery");
  const names = r =>
    [r.required, r.recommended, r.standalone, r.needsRating]
      .flat(2)
      .filter(Boolean)
      .concat(Object.keys(r.when || {}), r.via || [], r.as || []);
  for (const r of DATA.supported) {
    for (const t of [r.type, r.except, r.under].flat().filter(Boolean))
      assert.ok(VOCAB.types[t], `${t} is a schema.org type`);
    for (const p of names(r))
      assert.ok(VOCAB.props[p.replace(/-input$/, "")], `${r.type}: ${p} is a schema.org property`);
    assert.match(r.doc, /^https:\/\/developers\.google\.com\/search\/docs\/appearance\/structured-data\//);
    // The smallest item the rule applies to, nested where it must be: every required property is then missing.
    const when = Object.fromEntries(
      Object.entries(r.when || {}).map(([k, v]) => [k, v === "*" ? "https://example.com/x" : v]),
    );
    const item = { "@type": r.type, ...when },
      key = r.as || "x";
    const doc = r.under ? { ...CTX, "@type": [].concat(r.under)[0], [key]: [item, item] } : { ...CTX, ...item };
    const found = checkJsonLd(JSON.stringify(doc)).filter(i => i.path === (r.under ? `$.${key}[0]` : "$"));
    const says = (check, x) => found.some(i => i.check === check && i.message.startsWith(`missing ${label(x)},`));
    const free = x => ![].concat(x).some(k => k in when);
    for (const x of [...r.required, ...(r.under ? [] : r.standalone || [])].filter(free))
      assert.ok(says("required-missing", x), `${r.type} (${r.feature}): ${label(x)} is required`);
    for (const x of (r.recommended || []).filter(free))
      assert.ok(
        says("recommended-missing", x) || says("required-missing", x),
        `${r.type} (${r.feature}): ${label(x)} is recommended`,
      );
    if (r.needsRating)
      assert.ok(
        found.some(i => i.check === "rating-missing" && i.severity === "note"),
        `${r.type}: a missing rating is only a note`,
      );
  }
  for (const r of DATA.retired) {
    assert.ok(VOCAB.types[r.type], `${r.type} is a schema.org type`);
    assert.match(r.since, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(r.source, /^https:\/\/developers\.google\.com\/search\//);
    const [f, ...more] = retiredIn({ "@type": r.type });
    if (r.keep) {
      assert.equal(f, undefined, `${r.type} is kept: ${r.keep}`);
      continue;
    }
    assert.ok(f && !more.length, `${r.type} is flagged as retired, once`);
    assert.deepEqual([f.severity, f.rule, f.doc], ["warning", "SCHEMA-05", r.source]);
    assert.match(f.message, new RegExp(`"${r.type}"`));
    if (r.top)
      assert.deepEqual(
        retiredIn({ "@type": "Thing", x: { "@type": r.type } }),
        [],
        `${r.type} nested in another item isn't flagged`,
      );
  }
  assert.deepEqual(
    retiredIn({ "@type": "Recipe", name: "Soup", image: "https://example.com/s.jpg" }),
    [],
    "a Recipe is a kind of HowTo in schema.org, and still earns recipe results",
  );
  assert.deepEqual(retiredIn({ "@type": "WebSite", url: "https://example.com/" }), []);
});

test("every Google rich-result snippet in snippets.md passes schema-check", () => {
  const section = readFileSync(join(SKILL, "examples", "snippets.md"), "utf8")
    .split(/^## /m)
    .find(s => s.startsWith("Google rich results"));
  assert.ok(section, 'a "Google rich results" section');
  const blocks = [...section.matchAll(/```json\n([\s\S]*?)```/g)].map(m => m[1]);
  const types = new Set();
  const collect = v => {
    if (Array.isArray(v)) return v.forEach(collect);
    if (v && typeof v === "object") {
      [].concat(v["@type"] ?? []).forEach(t => types.add(t));
      Object.values(v).forEach(collect);
    }
  };
  for (const b of blocks) {
    collect(JSON.parse(b));
    const bad = checkJsonLd(b).filter(i => i.severity === "error" || i.check === "type-retired");
    assert.deepEqual(
      bad.map(i => `${i.path} (${i.type}): ${i.message}`),
      [],
      b.slice(0, 120),
    );
  }
  // One snippet per supported type (or a subtype, such as Plumber for LocalBusiness); types that only appear nested
  // come with their parent's.
  const isA = (t, base) => t === base || (VOCAB.types[t] || []).some(p => isA(p, base));
  for (const r of DATA.supported)
    if (!r.under && !r.when)
      assert.ok(
        [...types].some(t => isA(t, r.type)),
        `a snippet shows ${r.type} (${r.feature})`,
      );
});

// Stand-ins for PageSpeed Insights (/pricing/ fails, the rest pass) and the CrUX History API, recording each request.
const fixture = name => readFileSync(join(ROOT, "test", "fixtures", name), "utf8");
async function fakeApi(answer) {
  const hits = [];
  const server = createServer((req, res) => {
    let body = "";
    req
      .on("data", c => (body += c))
      .on("end", () => {
        const r = answer(req, body);
        hits.push(r.hit);
        res.writeHead(200, { "Content-Type": "application/json" }).end(r.json);
      });
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  return {
    url: `http://127.0.0.1:${server.address().port}/api`,
    hits,
    close: () => new Promise(ok => server.close(ok)),
  };
}
const psiAnswer = req => {
  const q = new URL(req.url, "http://x").searchParams,
    url = q.get("url") || "";
  return {
    hit: { url, strategy: q.get("strategy") },
    json: fixture(url.includes("/pricing/") ? "psi-fail.json" : "psi-pass.json"),
  };
};
const cruxAnswer = (req, body) => {
  const p75s = (a, b) => ({
    percentilesTimeseries: { p75s: Array.from({ length: 25 }, (_, i) => a + ((b - a) * i) / 24) },
  });
  const metrics = {
    largest_contentful_paint: p75s(1900, 1500),
    interaction_to_next_paint: p75s(90, 80),
    cumulative_layout_shift: p75s(0.03, 0.02),
  };
  return {
    hit: JSON.parse(body || "{}").formFactor,
    json: JSON.stringify({ record: { metrics, collectionPeriods: Array(25).fill({}) } }),
  };
};

test("with --outside --desktop, PageSpeed is asked for desktop, and the report shows a desktop line with bands", async () => {
  assert.deepEqual(
    [band("lcp", 2500), band("lcp", 2501), band("lcp", 4000), band("lcp", 4001)],
    ["good", "needs improvement", "needs improvement", "poor"],
  );
  assert.deepEqual(
    [band("inp", 200), band("inp", 201), band("inp", 500), band("inp", 501)],
    ["good", "needs improvement", "needs improvement", "poor"],
  );
  assert.deepEqual(
    [band("cls", 0.1), band("cls", 0.11), band("cls", 0.25), band("cls", 0.26)],
    ["good", "needs improvement", "needs improvement", "poor"],
  );
  const psi = await fakeApi(psiAnswer),
    crux = await fakeApi(cruxAnswer);
  const crawl = async extra => {
    const site = await serve(join(ROOT, "test", "fixture-zero")),
      out = join(tmp(), "crawl.json");
    try {
      await node(
        [
          join(SCRIPTS, "seo-crawl.mjs"),
          "--url",
          site.url,
          "--site-origin",
          "https://zero.example",
          "--psi-endpoint",
          psi.url,
          "--crux-endpoint",
          crux.url,
          "--out",
          out,
          ...extra,
        ],
        { env: { ...process.env, CRUX_API_KEY: "test-key", PSI_API_KEY: "" } },
      );
    } finally {
      await site.close();
    }
    return { ...JSON.parse(readFileSync(out, "utf8")), asked: psi.hits.splice(0), cruxAsked: crux.hits.splice(0) };
  };
  try {
    const off = await crawl(["--desktop"]);
    assert.deepEqual(
      [off.asked, off.cruxAsked],
      [[], []],
      "--desktop alone sends nothing: it needs outside checks too",
    );
    assert.ok(
      off.notes.some(n => /--desktop/.test(n) && /--outside/.test(n)),
      "a note says why it didn't run",
    );

    const phone = await crawl(["--outside"]);
    assert.ok(
      phone.asked.length && phone.asked.every(h => h.strategy === "mobile"),
      "outside checks alone ask for phones only",
    );
    assert.deepEqual(
      phone.cruxAsked,
      ["PHONE", "TABLET", "PHONE"],
      "the phone trend, then tablets and the home page alone",
    );
    assert.equal(phone.speed.desktop, undefined);

    const r = await crawl(["--outside", "--desktop"]);
    const asked = s =>
      r.asked
        .filter(h => h.strategy === s)
        .map(h => h.url)
        .sort();
    assert.ok(asked("desktop").length >= 1);
    assert.deepEqual(asked("desktop"), asked("mobile"), "the same sample pages, on desktop");
    assert.deepEqual(r.cruxAsked.sort(), ["DESKTOP", "PHONE", "PHONE", "TABLET"], "the trend for desktop too");
    assert.equal(r.speed.strategy, "mobile");
    assert.equal(r.speed.desktop.strategy, "desktop");
    assert.equal(r.speed.desktop.samples.length, asked("desktop").length);
    assert.deepEqual(r.speed.desktop.trend.lcp, [1900, 1500]);
    assert.equal(
      r.findings.find(f => f.check === "cwv-fail")?.count,
      1,
      "desktop data adds no finding: PERF-01 is about phones",
    );

    const dir = tmp(),
      data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
    data.speed = {
      ...r.speed,
      desktop: {
        strategy: "desktop",
        samples: [{ url: "https://example.com/", field: { lcp: 2600, inp: 520, cls: 0.05 }, origin: null, lab: {} }],
        trend: r.speed.desktop.trend,
      },
    };
    writeFileSync(join(dir, "a.json"), JSON.stringify(data));
    await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
    const line =
      /Real-user speed \(desktop\): LCP 2\.6 s \(needs improvement\) · INP 520 ms \(poor\) · CLS 0\.05 \(good\) · over 25 weeks: LCP 1\.9 → 1\.5 s \(better\)/;
    for (const f of ["r.html", "r.md"]) assert.match(readFileSync(join(dir, f), "utf8"), line, f);
  } finally {
    await psi.close();
    await crux.close();
  }
});

test("INP or CLS getting worse for real visitors is speed-slower; lab numbers aren't compared with field numbers", () => {
  const U = "https://e.com",
    paths = ["/a/", "/b/", "/c/", "/d/", "/f/", "/g/", "/h/"];
  const crawl = (mobile, desktop, labSpeed) => ({
    pages: paths.map(p => ({ url: U + p, status: 200 })),
    speed: {
      strategy: "mobile",
      samples: Object.entries(mobile).map(([p, field]) => ({ url: U + p, field, origin: null, lab: {} })),
      ...(desktop && {
        desktop: {
          strategy: "desktop",
          samples: Object.entries(desktop).map(([p, field]) => ({ url: U + p, field, origin: null, lab: {} })),
        },
      }),
    },
    labSpeed,
  });
  const v = (lcp, inp, cls) => ({ lcp, inp, cls });
  const before = crawl(
    {
      "/a/": v(2000, 120, 0.02),
      "/b/": v(2000, 120, 0.02),
      "/c/": v(2000, 150, 0.05),
      "/d/": v(2000, 180, 0.02),
      "/f/": v(2000, 300, 0.02),
      "/g/": v(2000, 120, 0.02),
      "/h/": null,
    },
    { "/h/": v(1000, 50, 0.01) },
    [{ url: U + "/h/", lcp: 1500, cls: 0.01 }],
  );
  const after = crawl(
    {
      "/a/": v(2000, 180, 0.02),
      "/b/": v(2000, 120, 0.08),
      "/c/": v(2000, 170, 0.06),
      "/d/": v(2000, 230, 0.02),
      "/f/": v(2000, 180, 0.02),
      "/g/": null,
      "/h/": v(4000, 400, 0.3),
    },
    { "/h/": v(1100, 60, 0.01) },
    [{ url: U + "/g/", lcp: 6000, cls: 0.4 }],
  );
  const d = diffCrawls(before, after),
    list = xs => xs.filter(c => c.kind.startsWith("speed")).map(c => `${c.path} ${c.kind} ${c.source}`);
  assert.deepEqual(
    list(d.regressions),
    ["/a/ speed-slower real visitors", "/b/ speed-slower real visitors", "/d/ speed-slower real visitors"],
    "INP up 60 ms (50%), CLS up 0.06, INP over its 200 ms limit; INP up 20 ms and CLS up 0.01 aren't real changes",
  );
  assert.deepEqual(list(d.improvements), ["/f/ speed-faster real visitors"], "INP back under its limit");
  assert.equal(d.regressions.find(c => c.path === "/a/").after, "LCP 2.0 s · INP 180 ms · CLS 0.02");
  // /g/ had field data and now only a lab run; /h/ had a lab run and desktop data and now phone field data: nothing
  // compares across sources.
  assert.ok(!d.regressions.some(c => ["/g/", "/h/"].includes(c.path)), "no source is compared with another");
  const desk = diffCrawls(before, crawl({}, { "/h/": v(1000, 150, 0.01) }));
  assert.deepEqual(
    list(desk.regressions),
    ["/h/ speed-slower real visitors, desktop"],
    "desktop is compared with desktop: INP 50 → 150 ms",
  );
});

test("a description that starts with the title is flagged; a different one isn't", async () => {
  const dir = tmp();
  const pageAt = (path, title, description, links = "") => {
    mkdirSync(join(dir, path), { recursive: true });
    writeFileSync(
      join(dir, path, "index.html"),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="${description}"></head><body><main><h1>${title}</h1><p>${"Our engineers cover Leeds and the towns around it, with fixed prices agreed before any work starts. ".repeat(4)}</p>${links}</main></body></html>`,
    );
  };
  pageAt(
    "",
    "Emergency plumbers in Leeds",
    "Emergency plumbers in Leeds, ready day and night for burst pipes, leaks and blocked drains, with fixed prices and no call-out fee.",
    ["boilers", "drains", "contact", "bathrooms"].map(p => `<a href="/${p}/">${p}</a>`).join(" "),
  );
  pageAt(
    "boilers",
    "Boiler repair and servicing in Leeds",
    "Boiler repair and servicing in West Yorkshire by Gas Safe engineers, with same-day visits and a twelve-month guarantee on parts.",
  );
  pageAt(
    "drains",
    "Drain unblocking in Leeds",
    "We clear blocked sinks, toilets and outside drains the same day, using cameras to find the cause so it doesn't come back.",
  );
  pageAt(
    "contact",
    "Contact us",
    "Contact us by phone, email or the form below, and we'll answer within the hour during the working day and by morning otherwise.",
  );
  pageAt(
    "bathrooms",
    "Bathroom fitting | Acme",
    "bathroom fitting | acme fits full bathrooms in Leeds in five working days, from removing the old suite to the last tile.",
  );
  const site = await serve(dir),
    out = join(tmp(), "crawl.json");
  try {
    await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, "--out", out]);
  } finally {
    await site.close();
  }
  const r = JSON.parse(readFileSync(out, "utf8"));
  const f = r.findings.find(x => x.check === "desc-starts-with-title");
  assert.ok(f, "desc-starts-with-title");
  assert.deepEqual([f.rule, f.severity], ["META-02", "low"]);
  assert.deepEqual(
    f.evidence.map(e => new URL(e.url).pathname).sort(),
    ["/", "/bathrooms/", "/boilers/"],
    "the whole title, most of it, or it in other capitals; a short title like “Contact us” is left alone",
  );
  assert.ok(r.passed.every(p => p.rule !== "META-02"));
});

test("FAQPage on a page with a visible FAQ isn't flagged as retired", async () => {
  const faq = {
    ...CTX,
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Do you charge a call-out fee?",
        acceptedAnswer: { "@type": "Answer", text: "No. You pay only for the work." },
      },
    ],
  };
  const dir = tmp(),
    file = join(dir, "faq.html"),
    out = join(dir, "out.json");
  writeFileSync(
    file,
    `<!doctype html><html><head><title>FAQ</title><script type="application/ld+json">${JSON.stringify(faq)}</script></head><body><h2>Do you charge a call-out fee?</h2><p>No. You pay only for the work.</p></body></html>\n`,
  );
  await node([join(SCRIPTS, "schema-check.mjs"), file, "--json", out]);
  assert.deepEqual(
    JSON.parse(readFileSync(out, "utf8")).issues,
    [],
    "no error, warning or retired flag: keep it where the FAQ is visible",
  );
  const [howTo] = retiredIn({ "@type": "HowTo", name: "Bleed a radiator" });
  assert.equal(howTo?.rule, "SCHEMA-05", "while HowTo is flagged");
});

test("ClaimReview is kept: schema-check shows its note as information, not a retired warning", () => {
  const issues = checkJsonLd(
    JSON.stringify({ ...CTX, "@type": "ClaimReview", claimReviewed: "The moon is cheese" }),
  ).filter(i => i.rule === "SCHEMA-05");
  assert.deepEqual(
    issues.map(i => [i.severity, i.check]),
    [["note", "type-kept"]],
  );
  assert.match(issues[0].message, /Fact Check Explorer still reads it/);
});

test("Google's rules: a Certification needs its name, and a forum post its text, image or video, which a url only excuses on another page", () => {
  const issues = o => checkJsonLd(JSON.stringify({ ...CTX, ...o }));
  const cert = issues({
    "@type": "Product",
    name: "Fridge",
    hasCertification: {
      "@type": "Certification",
      issuedBy: { "@type": "Organization", name: "European_Commission" },
      certificationIdentification: "123456",
    },
  });
  assert.deepEqual(
    cert.filter(i => i.path === "$.hasCertification").map(i => i.message),
    ['missing "name", required for Google merchant listings (certifications)'],
  );
  const post = {
    "@type": "DiscussionForumPosting",
    author: { "@type": "Person", name: "PipeFixer" },
    datePublished: "2026-11-02T09:15:00+00:00",
  };
  const content = i => /"text" or "image" or "video"/.test(i.message);
  assert.deepEqual(
    issues(post)
      .filter(content)
      .map(i => [i.severity, i.message]),
    [["error", 'missing "text" or "image" or "video", required for Google discussion forums']],
  );
  const listed = issues({ ...post, url: "https://example.com/forum/threads/1234/" }).filter(content);
  assert.deepEqual(
    listed.map(i => i.severity),
    ["note"],
    "with a url it may be a post shown on another page, which Google doesn't hold to it",
  );
  assert.match(listed[0].message, /another page/);
  assert.deepEqual(issues({ ...post, text: "Is there a safe way to free the valve?" }).filter(content), []);
});

test("the crawler flags every retired type in google-rich-results.json as deprecated-schema, but never FAQPage or ClaimReview", async () => {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  const pageAt = (path, title, schema, links = "") => {
    mkdirSync(join(dir, path), { recursive: true });
    writeFileSync(
      join(dir, path, "index.html"),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><script type="application/ld+json">${JSON.stringify({ ...CTX, ...schema })}</script></head><body><main><h1>${title}</h1>${links}</main></body></html>`,
    );
  };
  pageAt(
    "",
    "Fact checks",
    { "@type": "ClaimReview", claimReviewed: "The moon is cheese" },
    ["notice", "faq"].map(p => `<a href="/${p}/">${p}</a>`).join(" "),
  );
  pageAt("notice", "Opening hours notice", { "@type": "SpecialAnnouncement", name: "Closed on Monday" });
  pageAt("faq", "Questions", {
    "@type": "FAQPage",
    mainEntity: [{ "@type": "Question", name: "Open on Sunday?", acceptedAnswer: { "@type": "Answer", text: "No." } }],
  });
  const site = await serve(dir);
  try {
    await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, "--out", out]);
  } finally {
    await site.close();
  }
  const r = JSON.parse(readFileSync(out, "utf8")),
    f = r.findings.find(x => x.check === "deprecated-schema");
  assert.deepEqual([f?.rule, f?.severity], ["SCHEMA-05", "low"]);
  assert.deepEqual(
    f.evidence.map(e => `${new URL(e.url).pathname} ${e.detail}`).sort(),
    ["/notice/ SpecialAnnouncement"],
    "FAQPage and ClaimReview aren't flagged",
  );
  assert.doesNotMatch(f.title + f.why, /ClaimReview|fact check/);
  assert.ok(
    r.notes.some(n => /^ClaimReview on 1 page\(s\)/.test(n) && /Fact Check Explorer still reads it/.test(n)),
    r.notes.join("\n"),
  );
});

test("page-types.md gives a checklist for each page type, citing only rules that exist", () => {
  const text = readFileSync(join(SKILL, "page-types.md"), "utf8");
  for (const t of ["Home", "About", "Contact", "Service", "Product", "Category", "Article", "Location"])
    assert.match(text, new RegExp(`^## ${t}`, "m"));
  const defined = new Set(
    ["rules", "site-types"].flatMap(d =>
      readdirSync(join(SKILL, d)).flatMap(f =>
        [...readFileSync(join(SKILL, d, f), "utf8").matchAll(/^### ([A-Z]+-\d{2}) ·/gm)].map(m => m[1]),
      ),
    ),
  );
  const cited = [...text.matchAll(/\b([A-Z]+-\d{2})\b/g)].map(m => m[1]);
  assert.ok(cited.length >= 40, `${cited.length} rule IDs cited`);
  for (const id of cited) assert.ok(defined.has(id), `${id} is a rule`);
});
