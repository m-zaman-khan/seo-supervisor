// The report's site plan panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planStats, planHtml, planMarkdown, PLAN_CSS } from "../skills/seo-supervisor/scripts/report-plan.mjs";

// The same helpers the renderer passes in.
const esc = s =>
  String(s ?? "").replace(
    /[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const inl = s => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const num = n => Number(n).toLocaleString("en-US");
const ctx = { esc, inl, num };

const rows = [
  { url: "/", type: "Home", status: "exists" },
  { url: "/pricing", type: "Pricing page", status: "built", parent: "/" },
  { url: "/docs", type: "Docs hub", status: "to-build", parent: "/" },
  { url: "/privacy", type: "Privacy policy", status: "to-create", parent: "/" },
  { pattern: "/docs/{slug}", count: 40, built: 10, type: "Docs page", status: "to-build", parent: "/docs" },
];

test("progress counts each row once, and a pattern row by the share of its pages built", () => {
  const s = planStats({ status: "approved", pages: rows });
  assert.equal(s.rows, 5);
  assert.deepEqual(s.byStatus, { exists: 1, "to-build": 2, built: 1, "to-create": 1 });
  assert.equal(s.progress, 45); // (1 + 1 + 0 + 0 + 10/40) / 5
});

test("an empty plan or a pattern row with no pages never produces NaN", () => {
  const empty = planStats({ status: "proposed" });
  assert.equal(empty.rows, 0);
  assert.equal(empty.progress, 0);
  const zero = planStats({ status: "proposed", pages: [{ pattern: "/blog/{slug}", count: 0, status: "to-build" }] });
  assert.ok(Number.isFinite(zero.progress));
  assert.equal(zero.progress, 0);
});

test("owner items and 'needs your yes' items are counted separately", () => {
  const s = planStats({
    status: "proposed",
    yes: [
      { id: "Y1", what: "Redirect www to the apex domain", approved: false },
      { id: "Y2", what: "Allow AI search crawlers", approved: true },
    ],
    pages: [
      { url: "/", status: "to-build", owner: { needs: "copy", what: "Write the intro", done: false } },
      { url: "/pricing", status: "to-build", owner: { needs: "yes", what: "Titles live in the CMS", done: false } },
      { url: "/about", status: "built", owner: { needs: "facts", what: "Founding year", done: true } },
    ],
  });
  assert.equal(s.ownerOpen, 2);
  assert.equal(s.yesOpen, 2);
});

test("site text in the plan is escaped", () => {
  const html = planHtml(
    { status: "proposed", pages: [{ url: "/x", status: "to-build", title: `<script>alert(1)</script> & "x"` }] },
    ctx,
  );
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;x&quot;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test("the panel shows the summary, the structure, the table, owner labels and the yes list only when needed", () => {
  const html = planHtml(
    {
      status: "approved",
      summary: "Docs get a hub.",
      pages: [
        ...rows.slice(0, 3),
        { ...rows[3], owner: { needs: "copy", what: "Approve the draft", draft: "drafts/privacy.md", done: false } },
        rows[4],
      ],
    },
    ctx,
  );
  assert.match(html, /role="img"[^>]*aria-label="[^"]*45%/, "progress bar with an accessible label");
  assert.match(html, /Docs get a hub\./);
  assert.match(html, /class="own">Needs you</, "open owner item is labelled");
  assert.match(html, /href="drafts\/privacy\.md"/, "links the draft");
  assert.match(html, /\/docs\/\{slug\}[\s\S]*?×40/, "pattern rows show their page count");
  for (const label of ["Already right", "To build", "Built", "To create"]) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /Needs your yes/, "no yes items, no yes list");

  const withYes = planHtml(
    { status: "proposed", yes: [{ id: "Y1", what: "Redirect www to the apex domain", approved: false }], pages: rows },
    ctx,
  );
  assert.match(withYes, /Needs your yes[\s\S]*Redirect www to the apex domain/);

  assert.match(planHtml({ status: "proposed", pages: [] }, ctx), /No pages in this plan yet/);
});

test("a row without a target phrase shows a dash instead of an empty cell", () => {
  const html = planHtml(
    { status: "proposed", pages: [{ url: "/dashboard", type: "App screen", status: "to-build" }] },
    ctx,
  );
  assert.match(html, /<span class="pt"><span class="quiet">—<\/span><\/span>/);
});

test("the Markdown section starts with its heading and has one table row per plan row", () => {
  const md = planMarkdown({ status: "approved", pages: rows });
  assert.equal(md[0], "## SEO plan");
  const body = md.join("\n");
  for (const r of rows) assert.ok(body.includes(`| ${r.url || r.pattern}`), `row for ${r.url || r.pattern}`);
});

test("the plan CSS only uses the report's design tokens for colour", () => {
  assert.ok(PLAN_CSS.length > 0);
  assert.doesNotMatch(PLAN_CSS, /#[0-9a-f]{3,6}\b/i, "no hard-coded colours");
});

test("a missing parent page shows the intro the owner approves, in HTML and Markdown", () => {
  const plan = {
    status: "proposed",
    pages: [
      {
        url: "/docs",
        type: "Docs hub",
        status: "to-create",
        h1: "Docs",
        intro: "Guides for setting up and using Acme.",
      },
    ],
  };
  assert.match(planHtml(plan, ctx), /<dt>Intro<\/dt><dd>Guides for setting up and using Acme\.<\/dd>/);
  assert.match(planMarkdown(plan).join("\n"), /Guides for setting up and using Acme\./);
});

test("a declined yes item is recorded, shown as declined and no longer counted as open", () => {
  const plan = {
    status: "approved",
    yes: [{ id: "Y1", what: "Redirect www to the apex domain", approved: false, declined: true }],
    pages: [{ url: "/", status: "built" }],
  };
  assert.equal(planStats(plan).yesOpen, 0);
  const html = planHtml(plan, ctx);
  assert.match(html, /Declined[\s\S]*Redirect www to the apex domain/);
  assert.doesNotMatch(html, /<ol>[\s\S]*Redirect www/, "not listed as waiting");
  assert.match(planMarkdown(plan).join("\n"), /Declined: Y1/);
});

test("the plan lists the audit findings setup will also fix in code, linked to the findings", () => {
  const proposed = planHtml(
    { status: "proposed", alsoFixes: ["F-003", "F-007"], pages: [{ url: "/", status: "to-build" }] },
    ctx,
  );
  assert.match(proposed, /After the build, setup also fixes 2 audit findings in code/);
  assert.match(proposed, /<a href="#F-003">F-003<\/a>, <a href="#F-007">F-007<\/a>/);
  const built = planHtml({ status: "built", alsoFixes: ["F-003"], pages: [{ url: "/", status: "built" }] }, ctx);
  assert.match(built, /Setup also fixed 1 audit finding in code/);
  assert.doesNotMatch(planHtml({ status: "proposed", pages: [{ url: "/", status: "to-build" }] }, ctx), /also fix/);
  assert.match(
    planMarkdown({ status: "proposed", alsoFixes: ["F-003"], pages: [] }).join("\n"),
    /also fixes 1 audit finding in code: F-003/,
  );
});
