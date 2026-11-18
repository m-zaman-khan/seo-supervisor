import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, node, tmp } from "./helpers.mjs";

// Five town pages that only swap the town name, plus one real page with a placeholder description.
const towns = ["Dallas", "Plano", "Frisco", "Allen", "Wylie"];
const items = towns.map((t, i) => ({
  slug: `towing-${t.toLowerCase()}`,
  title: `Towing in ${t}`,
  description: `Fast, friendly towing in ${t} and nearby. Call us any time for a quote and a truck on the way.${i < 3 ? " Learn more" : ""}`,
  intro: `Need a tow in ${t}? Our drivers cover every road in ${t} day and night, with flatbeds for cars, vans and light trucks, and we answer the phone in under a minute every single time you call us.`,
  faqs: [
    { q: `Do you tow in ${t}?`, a: `Yes, we tow across ${t} around the clock.` },
    { q: "How much does a tow cost?", a: "Most local tows cost the same flat rate." },
  ],
  proof: i === 0 ? "Towed a Tesla off I-635 last week" : "",
  published: i < 4,
}));
items.push({
  slug: "heavy-duty",
  title: "Heavy duty towing",
  description: "Lorem ipsum placeholder",
  intro:
    "Semi trucks, buses and\u200B RVs need a rotator and a crew trained for big loads. We bring both, plus traffic control when a highway lane has to close. 73% of drivers we tow call us again.",
  faqs: [],
  proof: "Recovered a jackknifed semi on US-75",
  published: true,
});

test("the content scanner catches templated pages before they are published", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "content.json"), JSON.stringify(items));
  const out = join(dir, "scan.json");
  await node([
    join(SCRIPTS, "content-scan.mjs"),
    "--in",
    join(dir, "content.json"),
    "--id",
    "slug",
    "--url",
    "/{slug}/",
    "--title",
    "title",
    "--desc",
    "description",
    "--text",
    "intro",
    "--faq",
    "faqs",
    "--publish",
    "published",
    "--strip",
    towns.join("|"),
    "--required",
    "title,proof",
    "--out",
    out,
  ]);
  const scan = JSON.parse(readFileSync(out, "utf8"));
  const titles = scan.findings.map(f => `${f.rule} ${f.title}`);

  assert.equal(scan.stats.records, 6);
  assert.equal(scan.stats.distinctTexts, 2, "five town intros collapse to one text once the town name is removed");
  assert.ok(
    titles.some(t => /^CONTENT-04 .*share most of their copy/.test(t)),
    "templated copy",
  );
  assert.ok(
    titles.some(t => /^CONTENT-04 .*FAQ question/.test(t)),
    "reused FAQ question",
  );
  assert.ok(
    titles.some(t => /^CONTENT-05 .*missing required fields/.test(t)),
    "pages without local proof",
  );
  assert.ok(
    titles.some(t => /^CONTENT-09 /.test(t)),
    "placeholder text",
  );
  assert.ok(
    titles.some(t => /^CRAWL-11 .*unpublished/.test(t)),
    "unpublished item",
  );

  const by = check => scan.findings.find(f => f.check === check);
  assert.match(by("invisible-unicode")?.evidence[0].detail || "", /U\+200B/, "a zero-width space, named");
  assert.equal(by("invisible-unicode").evidence[0].url, "/heavy-duty/");
  assert.ok(
    by("templated-desc")?.evidence.some(e => /Learn more/.test(e.detail)),
    "descriptions ending in a stock call to action",
  );
  assert.equal(by("templated-desc").rule, "META-02");
  assert.match(by("unsourced-stat")?.evidence[0].detail || "", /73% of drivers/);
  assert.equal(by("unsourced-stat").severity, "needs-decision");
});

test("descriptions that start with their title and then say something specific aren't templated", async () => {
  const dir = tmp();
  const recs = ["How to winterize your RV", "How to store your boat", "How to clean a camper roof"].map((t, i) => ({
    slug: `p${i}`,
    title: t,
    description: `${t} in five steps, from draining every tank to checking the seals before the first frost arrives.`,
  }));
  writeFileSync(join(dir, "c.json"), JSON.stringify(recs));
  const out = join(dir, "scan.json");
  await node([
    join(SCRIPTS, "content-scan.mjs"),
    "--in",
    join(dir, "c.json"),
    "--id",
    "slug",
    "--title",
    "title",
    "--desc",
    "description",
    "--out",
    out,
  ]);
  assert.ok(!JSON.parse(readFileSync(out, "utf8")).findings.some(f => f.check === "templated-desc"));
});
