// Agent readiness (AI-05): unnamed form controls, and the agent files a site publishes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { agentFeatures, agentFiles } from "../skills/seo-supervisor/scripts/checks/agents.mjs";

const COPY =
  "Our team answers every question within a working day, and we keep a written record of what was agreed so nothing gets lost between calls, emails and visits. ".repeat(
    3,
  );
const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>${COPY}</p>${body}</main></body></html>`;

// Every way a control gets a name (HTML-AAM 4.1), and controls nobody reads out (hidden ones, template content).
const NAMED = `
  <form><label for="q">Search</label><input id="q" type="search" name="q"><button>Search</button></form>
  <label>Email <input type="email" name="email"></label>
  <input type="text" name="name" aria-label="Name"> <input type="text" name="city" placeholder="Your city">
  <input id="nick" name="nick"><label for="nick">Nickname</label>
  <textarea aria-labelledby="note-h"><input type="text"> is text here</textarea> <select title="Country"><option>UK</option></select>
  <input type="checkbox" name="terms" title="Accept the terms"> <input type="hidden" name="csrf"> <input type="submit"> <input type="reset">
  <input type="button" value="More"> <input type="image" src="/go.png" alt="Go">
  <button aria-label="Open menu"><svg viewBox="0 0 1 1"><path d="M0 0"/></svg></button> <button><svg><title>Close</title></svg></button>
  <button><img src="data:," alt="Cart"></button> <button><span class="visually-hidden">Search</span><svg viewBox="0 0 1 1"></svg></button>
  <button aria-hidden="true" tabindex="-1"></button> <button hidden></button> <input type="text" hidden>
  <template><input type="text"><button></button></template>`;
const UNNAMED = `
  <input type="email" name="newsletter"> <textarea name="message"></textarea> <select name="topic"><option>A</option></select>
  <label for="missing">Phone</label><input type="tel" id="phone2">
  <button class="icon-close"><svg viewBox="0 0 1 1"><path d="M0 0"/></svg></button> <input type="button" class="x">
  <input type="submit" value=""> <input type="image" src="/go.png">`;

test("form fields and buttons without a name are a low AI-05 finding; labelled ones aren't", async () => {
  const named = agentFeatures(page("Named controls", NAMED));
  assert.deepEqual([named.unnamedFields, named.unnamedButtons], [[], []]);
  assert.equal(named.controls, 17, "12 fields and 5 buttons; hidden ones and template content aren't counted");
  const unnamed = agentFeatures(page("Unnamed controls", UNNAMED));
  assert.deepEqual(unnamed.unnamedFields, [
    '<input type="email" name="newsletter">',
    '<textarea name="message">',
    '<select name="topic">',
    '<input type="tel" id="phone2">',
  ]);
  assert.deepEqual(
    unnamed.unnamedButtons,
    [
      '<input type="button" class="x">',
      '<input type="submit">',
      '<input type="image" src="/go.png">',
      '<button class="icon-close">',
    ],
    "an empty value takes away a submit button's default name, and an image button needs alt text",
  );
  assert.equal(agentFeatures(page("No controls", "")).controls, 0);

  const r = await agentSite();
  const f = r.findings.find(x => x.check === "controls-no-name");
  assert.deepEqual([f.rule, f.severity, f.category], ["AI-05", "low", "AI search"]);
  assert.deepEqual(
    f.evidence.map(e => new URL(e.url).pathname),
    ["/contact/"],
    "the labelled home page isn't flagged",
  );
  assert.equal(f.evidence[0].detail, '4 field(s) and 4 button(s), e.g. `<input type="email" name="newsletter">`');
  assert.ok(!r.passed.some(p => p.rule === "AI-05"));
});

// A shop with WebMCP tools, a UCP profile, an A2A agent card and an API catalog; /contact/ has unnamed controls.
let agentRun;
function agentSite() {
  return (agentRun ||= (async () => {
    const dir = tmp(),
      out = join(tmp(), "crawl.json");
    const pages = {
      "/": page("Northwind Bistro", `${NAMED}<a href="/contact/">Contact</a> <a href="/book/">Book a table</a>`),
      "/contact/": page("Contact the bistro", UNNAMED),
      "/book/": page(
        "Book a table",
        `<script>document.modelContext.registerTool({ description: "Find a free table", inputSchema: { type: "object", properties: { name: { type: "string" } } }, name: "findTable", async execute() {} });
        navigator.modelContext.registerTool({ "name": "<img src=x onerror=alert(1)>", execute() {} }); document.modelContext.registerTool(cancelTool);
        document.modelContext.registerTool({ name: TOOL_NAME, execute() {} }); const guest = { name: "Bob" };</script>
        <form toolname="bookTable" tooldescription="Book a table for a date"><label>Date <input type="date" name="date"></label><button>Book</button></form>
        <form toolname="halfDone"><label>Name <input name="who"></label><button>Go</button></form>`,
      ),
    };
    for (const [p, html] of Object.entries(pages)) {
      mkdirSync(join(dir, p), { recursive: true });
      writeFileSync(join(dir, p, "index.html"), html);
    }
    writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
    const json = o => ({ type: "application/json", body: JSON.stringify(o) });
    const site = await serve(dir, {
      files: {
        "/.well-known/ucp": json({ ucp: { version: "2026-08-25", services: {}, payment_handlers: {} } }),
        "/.well-known/agent-card.json": json({ name: "Bistro agent", description: "Books tables" }),
        "/.well-known/api-catalog": {
          type: "application/linkset+json",
          body: JSON.stringify({ linkset: [{ anchor: "https://site.example/api" }] }),
        },
      },
    });
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
  })());
}
const render = async data => {
  const dir = tmp();
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "a.html")]);
  return { html: readFileSync(join(dir, "a.html"), "utf8"), md: readFileSync(join(dir, "a.md"), "utf8") };
};

test("WebMCP tools, a UCP profile and agent files are listed, with no finding and no score change", async () => {
  const r = await agentSite();
  assert.deepEqual(
    r.agents.pages.map(p => [new URL(p.url).pathname, p.tools]),
    [["/book/", ["bookTable", "findTable", "<img src=x onerror=alert(1)>", "a tool set up by a script"]]],
    "a form needs both toolname and tooldescription; the tool's own name, not a schema property's",
  );
  assert.equal(r.agents.ucp, "2026-08-25");
  assert.deepEqual(r.agents.wellKnown, ["/.well-known/api-catalog", "/.well-known/agent-card.json"]);
  assert.deepEqual(
    r.findings.filter(f => f.check !== "controls-no-name" && /agent|webmcp|ucp/i.test(f.check + f.title)),
    [],
  );

  const withInfo = await render(r),
    without = await render({ ...r, agents: undefined });
  const det = withInfo.html.match(/\n {4}<details class="how agents">[\s\S]*?<\/details>/)?.[0];
  assert.ok(det, "an AI agents panel on the Overview");
  assert.equal(
    withInfo.html.replace(det, ""),
    without.html,
    "the panel is the only change: same score, same everything else",
  );
  assert.ok(
    det.includes("<code>/book/</code>") &&
      det.includes("bookTable") &&
      det.includes("version 2026-08-25") &&
      det.includes("/.well-known/agent-card.json"),
  );
  assert.ok(
    det.includes("&lt;img src=x onerror=alert(1)&gt;") && !withInfo.html.includes("<img src=x"),
    "tool names are escaped",
  );
  const sec = withInfo.md.match(/## AI agents\n[\s\S]*?\n\n(?=## )/)?.[0];
  assert.ok(sec, "an AI agents section in the Markdown");
  assert.equal(withInfo.md.replace(sec, ""), without.md);
  assert.ok(sec.includes("\\<img src=x onerror=alert(1)\\>") && sec.includes("`/.well-known/ucp`"));
  assert.ok(
    !without.html.includes('class="how agents"') && !without.md.includes("## AI agents"),
    "no agent data, no panel",
  );
});

test("agent files are read only from the crawled site, and a soft 404 page isn't a file", async () => {
  const asked = [];
  const fetchFn = async u => {
    asked.push(u);
    return new Response(u.endsWith("/ucp") ? "<!doctype html><title>Home</title>" : "{}", { status: 200 });
  };
  assert.deepEqual(
    await agentFiles(fetchFn, "https://shop.example"),
    { ucp: null, wellKnown: [] },
    "an HTML page and an empty object don't count",
  );
  assert.ok(asked.length && asked.every(u => u.startsWith("https://shop.example/.well-known/")), asked.join(" "));
  const down = await agentFiles(async () => {
    throw new Error("ECONNREFUSED");
  }, "https://shop.example");
  assert.deepEqual(down, { ucp: null, wellKnown: [] });
});
