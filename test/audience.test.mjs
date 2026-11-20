// The audience check, which the agent writes into seo-audit.json (audience.md), shown as one collapsed panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";

const SAMPLE = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
const render = async audiences => {
  const dir = tmp();
  writeFileSync(join(dir, "a.json"), JSON.stringify(audiences === undefined ? SAMPLE : { ...SAMPLE, audiences }));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "a.html")]);
  return { html: readFileSync(join(dir, "a.html"), "utf8"), md: readFileSync(join(dir, "a.md"), "utf8") };
};
const panelOf = html => html.match(/\n {4}<details class="how audience">[\s\S]*?<\/details>/)?.[0];
const sectionOf = md => md.match(/## Audience check\n[\s\S]*?\n\n(?=## )/)?.[0];
const ADMINS = () => ({
  name: "IT admins",
  wants: "a quick check of their domain's email setup",
  checked: "2026-11-21",
  pages: [
    {
      url: "https://security.example/",
      has: ["Says who it's for: “Free tools for IT admins” in the H1"],
      missing: ["No word on what the tools cost"],
    },
    {
      url: "https://security.example/tools/mx-lookup/",
      has: ["A clear next step: the Check button above the fold", "Proof: “Used by 4,000 teams”"],
      missing: [],
    },
  ],
});
const OWNERS = () => ({
  name: "Small business owners",
  wants: "to know if their email is safe",
  checked: "2026-11-21",
  pages: [
    {
      url: "https://security.example/",
      has: [],
      missing: ["Jargon in the first paragraph: “DMARC alignment” isn't explained"],
    },
  ],
});

test("the audience check renders on the Overview and in the Markdown, and changes nothing else: same score, findings and area scores", async () => {
  const withIt = await render([ADMINS(), OWNERS()]),
    without = await render();
  const det = panelOf(withIt.html);
  assert.ok(det, "a collapsed Audience check panel");
  assert.ok(
    withIt.html.indexOf(det) > withIt.html.indexOf('id="p-overview"') &&
      withIt.html.indexOf(det) < withIt.html.indexOf('id="p-findings"'),
    "on the Overview",
  );
  assert.equal(withIt.html.replace(det, ""), without.html, "the panel is the only change");
  for (const s of [
    "<b>IT admins</b>",
    "a quick check of their domain&#39;s email setup",
    "2026-11-21",
    "<code>/</code>",
    "<code>/tools/mx-lookup/</code>",
    "On the page: A clear next step: the Check button above the fold · Proof: “Used by 4,000 teams”",
    "Missing: No word on what the tools cost",
    "<b>Small business owners</b>",
  ])
    assert.ok(det.includes(s), s);
  assert.match(det, /never changes the score/);
  assert.doesNotMatch(det, /\d\s*%|\/100/, "no scores or percentages");

  const sec = sectionOf(withIt.md);
  assert.ok(sec, "an Audience check section in the Markdown");
  assert.equal(withIt.md.replace(sec, ""), without.md);
  assert.match(
    sec,
    /^### IT admins\n\nWhat they come for: a quick check of their domain's email setup\. Checked on 2026-11-21\.$/m,
  );
  assert.match(
    sec,
    /^- `\/tools\/mx-lookup\/`\n {2}- On the page: A clear next step: the Check button above the fold · Proof: “Used by 4,000 teams”$/m,
  );
  assert.match(sec, /^- `\/`\n {2}- Missing: Jargon in the first paragraph: “DMARC alignment” isn't explained$/m);
});

test("no audiences, or an empty or odd value, adds nothing", async () => {
  const none = await render();
  assert.doesNotMatch(none.html + none.md, /Audience check|class="how audience"/);
  for (const v of [[], {}, "IT admins", null]) {
    const r = await render(v);
    assert.equal(r.html, none.html, JSON.stringify(v));
    assert.equal(r.md, none.md, JSON.stringify(v));
  }
});

test("everything the agent wrote is escaped: names, wants, page addresses and quoted page text", async () => {
  const XSS = "<img src=x onerror=alert(1)>";
  const { html, md } = await render([
    {
      name: `Admins ${XSS}`,
      wants: `[x](javascript:alert(1)) ${XSS}`,
      checked: "<b>today</b>",
      pages: [{ url: `/a\`b/${XSS}`, has: [`Quote: ${XSS}\n## Not a heading`], missing: [`**bold** _it_ ${XSS}`] }],
    },
  ]);
  const det = panelOf(html);
  assert.ok(det);
  assert.doesNotMatch(html, /<img src=x|<b>today/);
  assert.ok(
    det.includes("<code>/a`b/&lt;img src=x onerror=alert(1)&gt;</code>") &&
      det.includes("<b>Admins &lt;img src=x onerror=alert(1)&gt;</b>"),
  );
  assert.doesNotMatch(det, /today/, "a checked value that isn't a date is left out");
  const sec = sectionOf(md);
  assert.ok(sec);
  assert.ok(
    sec.includes("- `/a b/<img src=x onerror=alert(1)>`\n"),
    "the address is a code span with no backtick inside",
  );
  const text = sec.replace(/`[^`\n]*`/g, "");
  assert.doesNotMatch(text, /(^|[^\\])<img src=x/m, "no raw HTML outside code");
  assert.doesNotMatch(text, /(^|[^\\])\[x\]\(javascript:/m, "no link");
  assert.doesNotMatch(sec, /^## Not a heading/m, "a line break in page text can't start a heading");
  assert.ok(sec.includes("\\*\\*bold\\*\\* \\_it\\_"), "Markdown characters are escaped");
});

test("malformed entries are skipped quietly, and the lists are capped", async () => {
  const messy = [
    null,
    "Landlords",
    7,
    { name: "" },
    { name: 5, pages: ADMINS().pages },
    { name: "No pages", pages: "x" },
    {
      name: "Bad pages",
      pages: [
        null,
        { url: 5, has: ["x"] },
        { url: "", has: ["x"] },
        { url: "https://security.example/", has: "x", missing: [1, null, "", "  "] },
      ],
    },
    {
      ...ADMINS(),
      wants: 42,
      checked: 20261121,
      score: 99,
      severity: "blocker",
      pages: [...ADMINS().pages, { url: "https://security.example/x/", has: [3], missing: {} }],
    },
  ];
  const clean = { ...ADMINS() };
  delete clean.wants;
  delete clean.checked;
  assert.equal(
    (await render(messy)).html,
    (await render([clean])).html,
    "only the valid audience and its valid pages show",
  );
  assert.equal((await render(messy)).md, (await render([clean])).md);

  const many = Array.from({ length: 6 }, (_, a) => ({
    name: `Audience ${a}`,
    wants: "w",
    pages: Array.from({ length: 7 }, (_, p) => ({
      url: `https://security.example/p${p}/`,
      has: Array.from({ length: 12 }, (_, i) => `item ${i}`),
      missing: [],
    })),
  }));
  const { html, md } = await render(many);
  const det = panelOf(html);
  assert.deepEqual(
    [...det.matchAll(/<b>(Audience \d)<\/b>/g)].map(m => m[1]),
    ["Audience 0", "Audience 1", "Audience 2", "Audience 3"],
    "up to 4 audiences",
  );
  assert.equal(det.match(/<code>\/p\d\/<\/code>/g).length, 4 * 5, "up to 5 pages each");
  assert.ok(det.includes("item 9<") && !det.includes("item 10"), "up to 10 items a list");
  assert.equal(sectionOf(md).match(/^- `\/p\d\/`/gm).length, 4 * 5, "the Markdown has the same caps");
});
