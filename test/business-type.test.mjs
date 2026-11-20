import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, SKILL, node, tmp } from "./helpers.mjs";
import {
  BUSINESS_TYPES,
  CHECKS,
  detectBusinessType,
  checkBusinessType,
} from "../skills/seo-supervisor/scripts/checks/business-type.mjs";
import { checkJsonLd } from "../skills/seo-supervisor/scripts/schema-check.mjs";

const VOCAB = JSON.parse(readFileSync(join(SCRIPTS, "data", "schema-vocab.json"), "utf8"));
const ancestors = t => new Set([t, ...(VOCAB.types[t] || []).flatMap(p => [...ancestors(p)])]);

async function crawl(pages) {
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
// A business node plus WebSite, so SCHEMA-02 can pass when the type is right.
const graph = (type, name) => ({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": type, "@id": "https://site.example/#organization", name, address: "1 High Street, Leeds" },
    { "@type": "WebSite", "@id": "https://site.example/#website", name, url: "https://site.example/" },
  ],
});
const page = (title, h1, body, schema) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${schema ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>` : ""}</head><body><main><h1>${h1}</h1>${body}</main></body></html>`;
const findingOf = (r, check) => r.findings.find(f => f.check === check);
// The pure check, collecting what it would add.
const collect = pages => {
  const found = [];
  const bt = checkBusinessType(pages, (key, url, detail) => found.push({ key, url, detail }));
  return { bt, found };
};
const home = (title, h1, text = "", types = ["LocalBusiness"]) => ({
  url: "https://site.example/",
  title,
  h1,
  text,
  types,
});

test("every type and property in business-types.json exists in schema-vocab.json", () => {
  const map = JSON.parse(readFileSync(join(SCRIPTS, "data", "business-types.json"), "utf8"));
  assert.deepEqual(map, BUSINESS_TYPES);
  assert.ok(map.length >= 13, "at least the spec's starting set");
  const ids = new Set();
  for (const b of map) {
    assert.deepEqual(
      Object.keys(b).sort(),
      ["feature", "id", "keywords", "label", "mistakes", "properties", "types"],
      b.id,
    );
    assert.ok(!ids.has(b.id), `${b.id} is listed twice`);
    ids.add(b.id);
    assert.ok(b.types.length && b.properties.length && b.keywords.length, `${b.id} has types, properties and keywords`);
    assert.ok(b.feature === null || typeof b.feature === "string", b.id);
    assert.ok(Array.isArray(b.mistakes) && b.mistakes.every(m => typeof m === "string"), b.id);
    for (const t of b.types) assert.ok(VOCAB.types[t], `${b.id}: ${t} isn't a schema.org type`);
    // Each property is defined for the suggested type (types[0]) or one of its parents.
    const own = ancestors(b.types[0]);
    for (const p of b.properties) {
      assert.ok(VOCAB.props[p], `${b.id}: ${p} isn't a schema.org property`);
      assert.ok(
        VOCAB.props[p][0].some(d => own.has(d)),
        `${b.id}: ${p} isn't a property of ${b.types[0]}`,
      );
    }
  }
  const words = map.flatMap(b => b.keywords.map(k => k.toLowerCase()));
  assert.deepEqual(
    words.filter((w, i) => words.indexOf(w) !== i),
    [],
    "each keyword points to one business type",
  );
  for (const id of [
    "restaurant",
    "dentist",
    "lawyer",
    "real-estate",
    "car-dealer",
    "hotel",
    "plumber",
    "hair-salon",
    "gym",
    "online-store",
    "software",
    "school",
    "publisher",
  ])
    assert.ok(ids.has(id), `the spec's starting set has ${id}`);
  const lawyer = map.find(b => b.id === "lawyer");
  assert.deepEqual(lawyer.types, ["LegalService"], "Attorney is deprecated on schema.org");
});

test("a dental clinic marked LocalBusiness gets schema-too-generic suggesting Dentist; one marked Dentist passes", async () => {
  const site = type => ({
    "/": page(
      "Smile Dental Clinic | Leeds",
      "Your family dental clinic in Leeds",
      "<p>Check-ups, hygiene visits and fillings for the whole family, with evening appointments.</p>",
      graph(type, "Smile Dental Clinic"),
    ),
  });
  const [generic, specific] = await Promise.all([crawl(site("LocalBusiness")), crawl(site("Dentist"))]);
  const f = findingOf(generic, "schema-too-generic");
  assert.ok(f, "raised for LocalBusiness");
  assert.deepEqual([f.rule, f.severity, f.count], ["SCHEMA-02", "medium", 1]);
  assert.equal(new URL(f.evidence[0].url).pathname, "/");
  assert.match(f.evidence[0].detail, /use Dentist instead of LocalBusiness/);
  assert.match(f.evidence[0].detail, /dental clinic/, "says what the evidence is");
  assert.match(f.fix, /snippets\.md/);
  assert.deepEqual([generic.businessType.guess, generic.businessType.confidence], ["dentist", "strong"]);
  assert.ok(
    generic.businessType.evidence.some(e => /^title “Smile Dental Clinic \| Leeds”/.test(e)),
    generic.businessType.evidence.join(" | "),
  );

  for (const k of ["schema-too-generic", "business-type-unclear"])
    assert.ok(!findingOf(specific, k), `${k} isn't raised for Dentist`);
  assert.deepEqual([specific.businessType.guess, specific.businessType.confidence], ["dentist", "strong"]);
  assert.ok(
    specific.passed.some(p => p.rule === "SCHEMA-02"),
    "SCHEMA-02 passes with the right type",
  );

  // Organization is as general as LocalBusiness; a subtype of the suggestion is specific enough.
  assert.deepEqual(
    collect([home("Smile Dental Clinic", "Your family dentist", "", ["Organization"])]).found.map(x => x.key),
    ["schema-too-generic"],
  );
  assert.deepEqual(
    collect([home("Leeds Family Doctors", "Your local GP practice", "", ["PhysiciansOffice"])]).found,
    [],
  );
});

test("two close candidates give a needs-decision naming both; no evidence gives nothing", () => {
  const split = collect([home("Riverside Dental and Medical Clinic", "Dentists and nurses under one roof")]);
  assert.equal(split.bt.confidence, "weak");
  assert.deepEqual([split.bt.guess, split.bt.alternatives[0]], ["dentist", "clinic"]);
  assert.deepEqual(
    split.found.map(x => x.key),
    ["business-type-unclear"],
  );
  assert.match(split.found[0].detail, /^Dentist or MedicalClinic\?/);
  assert.deepEqual(CHECKS["business-type-unclear"].slice(0, 2), ["SCHEMA-02", "needs-decision"]);

  // Already one of the two in schema: nothing to ask.
  assert.deepEqual(
    collect([home("Riverside Dental and Medical Clinic", "Dentists and nurses under one roof", "", ["Dentist"])]).found,
    [],
  );

  const none = collect([
    home("Acme Ltd", "Welcome", "We make things people love, and we ship them fast.", ["Organization"]),
  ]);
  assert.deepEqual(none.bt, { guess: null, alternatives: [], evidence: [], confidence: "none" });
  assert.deepEqual(none.found, []);
  assert.deepEqual(detectBusinessType([]), { guess: null, alternatives: [], evidence: [], confidence: "none" });

  // Words in the body alone are too weak to raise anything, even for two trades.
  const agency = collect([
    home(
      "Northwind Growth",
      "We grow local businesses",
      "Our clients include restaurants, dentists and plumbers across the north.",
      ["Organization"],
    ),
  ]);
  assert.equal(agency.bt.confidence, "weak");
  assert.deepEqual(agency.found, []);
  // Words that look like a trade but aren't one.
  assert.equal(
    detectBusinessType([home("Pub/Sub for Teams", "A website builder with a fast SPA", "", ["Organization"])]).guess,
    null,
  );
  // A business that serves a trade isn't that trade.
  const saas = collect([
    home(
      "Software for Dental Clinics",
      "Dental practice software that runs itself",
      "Built for dentists and orthodontists.",
      ["Organization"],
    ),
  ]);
  assert.deepEqual([saas.bt.guess, saas.bt.confidence, saas.found], ["software", "strong", []]);
});

test("a page that mentions another trade doesn't change the guess", async () => {
  // A plumber's home page lists two blog posts, one of them about dentists; the post itself is all about dentists.
  const teasers = `<article><h2><a href="/blog/dental-water-lines/">Why dentists need clean water lines</a></h2><p>Every dental surgery depends on clean water.</p></article>
    <article><h2><a href="/blog/radiators/">How to bleed a radiator</a></h2><p>Five minutes and a radiator key.</p></article>`;
  const front = body =>
    page(
      "Northside Plumbing | Leeds",
      "Emergency plumber in Leeds",
      `<p>Leaks, burst pipes and boiler repairs fixed the same day, across the city.</p>${body}`,
      graph("LocalBusiness", "Northside Plumbing"),
    );
  const post = (title, text) =>
    page(title, title, `<article><p>${text}</p></article>`, {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: title,
    });
  const [withBlog, without] = await Promise.all([
    crawl({
      "/": front(teasers),
      "/blog/dental-water-lines/": post(
        "Why Dentists Need Clean Water Lines",
        "A dentist, a dental clinic and an orthodontist all rely on clean water lines. Dental practices should flush them daily.",
      ),
      "/blog/radiators/": post("How to Bleed a Radiator", "Turn the heating off first."),
    }),
    crawl({ "/": front("") }),
  ]);
  assert.deepEqual(withBlog.businessType, without.businessType, "the blog and its teasers change nothing");
  assert.deepEqual([withBlog.businessType.guess, withBlog.businessType.confidence], ["plumber", "strong"]);
  assert.ok(!withBlog.businessType.alternatives.includes("dentist"));
  const f = findingOf(withBlog, "schema-too-generic");
  assert.match(f.evidence[0].detail, /use Plumber instead of LocalBusiness/);
  assert.doesNotMatch(f.evidence[0].detail, /dent/i);
  assert.ok(!findingOf(withBlog, "business-type-unclear"));
});

test("every business-type snippet in snippets.md passes schema-check", () => {
  const md = readFileSync(join(SKILL, "examples", "snippets.md"), "utf8");
  const section = md.split(/^## Business types.*$/m)[1];
  assert.ok(section, "snippets.md has a Business types section");
  const blocks = [...section.split(/^## /m)[0].matchAll(/```json\n([\s\S]*?)```/g)].map(m => m[1]);
  assert.ok(blocks.length >= 12, `${blocks.length} snippets`);
  const mapped = new Set(BUSINESS_TYPES.flatMap(b => b.types));
  for (const b of blocks) {
    assert.deepEqual(
      checkJsonLd(b).filter(i => i.severity === "error"),
      [],
      b.slice(0, 120),
    );
    const top = [].concat(JSON.parse(b)["@type"]);
    assert.ok(
      top.some(t => mapped.has(t)),
      `${top} is a type the map suggests`,
    );
  }
});
