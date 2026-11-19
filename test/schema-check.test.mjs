import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { checkJsonLd } from "../skills/seo-supervisor/scripts/schema-check.mjs";
import { SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";

const CHECK = join(SCRIPTS, "schema-check.mjs");
const VOCAB = join(SCRIPTS, "data", "schema-vocab.json");
const ld = o => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const page = (...blocks) =>
  `<!doctype html>\n<html><head>\n<title>x</title>\n${blocks.join("\n")}\n</head><body></body></html>\n`;
const PRODUCT = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Widget",
  image: "https://example.com/w.jpg",
  description: "A widget.",
  offers: {
    "@type": "Offer",
    price: "19.99",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
    url: "https://example.com/w/",
  },
};
const issues = (o, kind) => checkJsonLd(JSON.stringify(o)).filter(i => !kind || i.check === kind);
const errors = o => issues(o).filter(i => i.severity === "error");
// Runs the CLI and returns its exit code instead of throwing on a non-zero one.
const run = (args, opts) =>
  node([CHECK, ...args], opts).then(
    r => ({ code: 0, ...r }),
    e => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }),
  );
const write = (dir, name, body) => {
  const f = join(dir, name);
  writeFileSync(f, body);
  return f;
};

test("the vocabulary file loads, is small and carries the release and licence", () => {
  const v = JSON.parse(readFileSync(VOCAB, "utf8"));
  assert.match(v.version, /^\d+\.\d+$/);
  assert.match(v.license, /CC BY-SA 3\.0/);
  assert.ok(v.props.offers[0].includes("Product"), "Product.offers");
  assert.deepEqual(v.types.LocalBusiness.sort(), ["Organization", "Place"]);
  assert.ok(statSync(VOCAB).size < 400 * 1024);
});

test("a valid Product passes, and inherited properties count", () => {
  assert.deepEqual(errors(PRODUCT), []);
  assert.deepEqual(issues(PRODUCT), [], "no warnings either");
  assert.deepEqual(
    errors({ ...PRODUCT, sameAs: ["https://example.com/a"], "@id": "https://example.com/w/#product" }),
    [],
    "Thing.sameAs, @id",
  );
});

test("an unknown property and an unknown type are errors", () => {
  const [p] = errors({ ...PRODUCT, colour: "red" });
  assert.equal(p.check, "prop-unknown");
  assert.match(p.message, /colour/);
  assert.equal(errors({ ...PRODUCT, "@type": "Prodcut" })[0].check, "type-unknown");
  assert.match(errors({ ...PRODUCT, "@type": "product" })[0].message, /Product/, "suggests the right case");
  assert.equal(
    errors({ "@context": "https://schema.org", "@type": "Person", name: "A", offers: PRODUCT.offers })[0].check,
    "prop-unknown",
    "a real property on the wrong type",
  );
});

test("Google's required properties: a missing Offer price is an error, a missing recommended one a warning", () => {
  const [e] = errors({ ...PRODUCT, offers: { "@type": "Offer", priceCurrency: "USD" } });
  assert.equal(e.check, "required-missing");
  assert.match(e.message, /price/);
  assert.equal(e.path, "$.offers");
  assert.match(e.doc, /^https:\/\/developers\.google\.com\/search\/docs\/appearance\/structured-data\//);
  assert.equal(
    errors({ "@context": "https://schema.org", "@type": "Product", name: "W" })[0].check,
    "required-missing",
    "offers, review or aggregateRating",
  );
  const { image, ...noImage } = PRODUCT;
  assert.deepEqual(
    issues(noImage).map(i => `${i.severity} ${i.check}`),
    ["warning recommended-missing"],
  );
  // Breadcrumbs: the last item may leave out `item`; a Review on its own needs itemReviewed, nested it doesn't.
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://example.com/" },
      { "@type": "ListItem", position: 2, name: "Widget" },
    ],
  };
  assert.deepEqual(errors(crumbs), []);
  assert.equal(
    errors({
      ...crumbs,
      itemListElement: [{ "@type": "ListItem", position: 1, name: "Home" }, crumbs.itemListElement[1]],
    })[0].path,
    "$.itemListElement[0]",
  );
  const review = {
    "@type": "Review",
    author: { "@type": "Person", name: "A" },
    reviewRating: { "@type": "Rating", ratingValue: 4 },
  };
  assert.match(errors({ "@context": "https://schema.org", ...review })[0].message, /itemReviewed/);
  assert.deepEqual(errors({ ...PRODUCT, review }), []);
});

test("value shapes: a URL property needs a URL, a date property an ISO 8601 date", () => {
  assert.equal(errors({ ...PRODUCT, url: "Widget page" })[0].check, "value-url");
  assert.equal(issues({ ...PRODUCT, url: "/w/" })[0].severity, "warning", "relative URLs work but should be absolute");
  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "H",
    image: "https://example.com/a.jpg",
    author: { "@type": "Person", name: "A" },
    datePublished: "2026-11-02",
    dateModified: "2026-11-03T10:00:00+01:00",
  };
  assert.deepEqual(issues(article), []);
  assert.equal(errors({ ...article, datePublished: "2 Nov 2026" })[0].check, "value-date");
});

test("graphs, arrays and other vocabularies", () => {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://example.com/#org",
        name: "Acme",
        url: "https://example.com/",
        logo: "https://example.com/l.png",
      },
      {
        "@type": "WebSite",
        "@id": "https://example.com/#website",
        url: "https://example.com/",
        publisher: { "@id": "https://example.com/#org" },
        potentialAction: {
          "@type": "SearchAction",
          target: "https://example.com/?q={q}",
          "query-input": "required name=q",
        },
      },
    ],
  };
  assert.deepEqual(errors(graph), []);
  assert.equal(errors([PRODUCT, { ...PRODUCT, nope: 1 }])[0].path, "$[1]");
  assert.deepEqual(
    issues({ "@context": "https://example.org/vocab", "@type": "Gadget", whatever: 1 }),
    [],
    "not schema.org: not checked",
  );
});

test("bad JSON is reported with its line, not a crash; HTML blocks are found with their line", async () => {
  const dir = tmp();
  const bad = write(
    dir,
    "bad.html",
    page(
      '<script type="application/ld+json">\n{ "@context": "https://schema.org",\n  "@type": "Product" "name": "x" }\n</script>',
    ),
  );
  const r = await run([bad, "--json", join(dir, "out.json")]);
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.stderr + r.stdout, /at .*\.mjs:\d+/, "no stack trace");
  const out = JSON.parse(readFileSync(join(dir, "out.json"), "utf8"));
  assert.equal(out.issues[0].check, "json-invalid");
  assert.equal(out.issues[0].line, 6, "line in the HTML file");

  const good = write(
    dir,
    "good.html",
    page(
      ld({ "@context": "https://schema.org", "@type": "WebSite", name: "x", url: "https://example.com/" }),
      ld({ ...PRODUCT, colour: "red" }),
    ),
  );
  await run([good, "--json", join(dir, "out.json")]);
  const o = JSON.parse(readFileSync(join(dir, "out.json"), "utf8"));
  assert.equal(o.items, 2);
  assert.deepEqual(
    o.issues.map(i => [i.check, i.line, i.block]),
    [["prop-unknown", 5, 2]],
  );
});

test("CLI: exit codes, --quiet, folders and the local-only URL rule", async () => {
  const dir = tmp(),
    site = join(dir, "out");
  mkdirSync(join(site, "w"), { recursive: true });
  write(site, "index.html", page(ld(PRODUCT)));
  write(join(site, "w"), "index.html", page("<p>no structured data here</p>"));
  write(site, "manifest.json", JSON.stringify({ name: "not JSON-LD" }));
  const pass = await run([site, "--quiet"]);
  assert.deepEqual([pass.code, pass.stdout, pass.stderr], [0, "", ""], "silent on a pass");
  assert.match((await run([site])).stdout, /2 files, 1 item, 0 errors/);

  write(site, "p.jsonld", JSON.stringify({ ...PRODUCT, colour: "red" }));
  const fail = await run([site, "--quiet"]);
  assert.equal(fail.code, 1);
  assert.match(fail.stdout, /p\.jsonld.*colour/);

  assert.equal((await run([])).code, 2, "usage");
  const remote = await run(["https://example.com/"]);
  assert.equal(remote.code, 2);
  assert.match(remote.stderr, /--allow-remote/);

  const server = createServer((req, res) =>
    res.writeHead(200, { "Content-Type": "text/html" }).end(page(ld({ ...PRODUCT, colour: "red" }))),
  );
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  try {
    const local = await run([`http://127.0.0.1:${server.address().port}/`]);
    assert.equal(local.code, 1);
    assert.match(local.stdout, /colour/);
  } finally {
    server.close();
  }
});

test("--hook reads the agent's payload: checks edited JSON-LD files, ignores the rest", async () => {
  const dir = tmp();
  const bad = write(dir, "p.html", page(ld({ ...PRODUCT, colour: "red" })));
  const plain = write(dir, "notes.html", page("<p>hi</p>"));
  const input = (payload, extra = []) => {
    const p = node([CHECK, "--hook", ...extra]);
    p.child.stdin.end(JSON.stringify(payload));
    return p.then(
      r => ({ code: 0, ...r }),
      e => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }),
    );
  };
  // Claude Code and Codex: exit 2 sends stderr back to the agent.
  const claude = await input({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: bad } });
  assert.equal(claude.code, 2);
  assert.match(claude.stderr, /colour/);
  assert.deepEqual(
    await input({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: plain } }),
    { code: 0, stdout: "", stderr: "" },
  );
  assert.deepEqual(
    await input({ tool_input: { file_path: join(dir, "app.tsx") } }),
    { code: 0, stdout: "", stderr: "" },
    "source templates aren't checked",
  );
  // Codex apply_patch puts the patch in tool_input.command; Copilot sends toolArgs, maybe as a JSON string.
  assert.equal(
    (
      await input({
        cwd: dir,
        tool_name: "apply_patch",
        tool_input: { command: "*** Begin Patch\n*** Update File: p.html\n@@\n*** End Patch" },
      })
    ).code,
    2,
  );
  assert.equal((await input({ toolName: "edit", toolArgs: JSON.stringify({ path: bad }) })).code, 2);
  // Copilot only shows the model a postToolUse hook's additionalContext, printed as JSON on a 0 exit.
  const copilot = await input({ toolName: "create", toolArgs: { path: bad } }, ["copilot"]);
  assert.equal(copilot.code, 0);
  assert.match(JSON.parse(copilot.stdout).additionalContext, /colour/);
});

test("the trigger templates parse and run the checker", () => {
  const H = join(SKILL, "examples", "hooks"),
    text = f => readFileSync(join(H, f), "utf8");
  for (const f of ["claude-code-settings.json", "codex-hooks.json", "cursor-hooks.json", "copilot-hooks.json"]) {
    assert.doesNotThrow(() => JSON.parse(text(f)), f);
    assert.match(text(f), /schema-check\.mjs\\?"? --hook/, f);
  }
  for (const f of ["pre-commit", "github-actions.yml"]) assert.match(text(f), /schema-check\.mjs[\s\S]* --quiet/, f);
  assert.match(text("README.md"), /opt-in/);
});
