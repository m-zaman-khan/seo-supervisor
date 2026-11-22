import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { findBrowser, renderAll, renderPage } from "../../skills/seo-supervisor/scripts/checks/render.mjs";
import { serve } from "../serve.mjs";
import { SCRIPTS, node, tmp } from "../helpers.mjs";

const browser = findBrowser();
test(
  "Chrome failing to load a page is an error from the render step, not an empty page",
  { skip: !browser && "Chrome not installed", timeout: 60000 },
  async t => {
    const closed = createServer();
    await new Promise(ok => closed.listen(0, "127.0.0.1", ok));
    const port = closed.address().port;
    await new Promise(ok => closed.close(ok));
    try {
      await renderPage(browser, `http://127.0.0.1:${port}/`);
      assert.fail("the render resolved");
    } catch (e) {
      if (/sandbox/i.test(`${e.message} ${e.stderr || ""}`)) return t.skip("Chrome sandbox unavailable here");
      assert.match(e.message, /Chrome couldn't load http:\/\/127\.0\.0\.1:\d+\/: net::ERR_CONNECTION_REFUSED/);
    }
  },
);

test(
  "a page Chrome can't load isn't reported as JavaScript changing its title: it's left out, with the reason",
  { skip: !browser && "Chrome not installed", timeout: 180000 },
  async () => {
    const dir = tmp(),
      out = join(tmp(), "crawl.json");
    const page = (title, link) =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>Boiler repairs and servicing across Leeds, with a written estimate first.</p>${link}</main></body></html>`;
    for (const [p, html] of Object.entries({
      "/": page("Boiler Repairs in Leeds", '<a href="/about/">About us</a>'),
      "/about/": page("About Our Leeds Engineers", ""),
    })) {
      mkdirSync(join(dir, p), { recursive: true });
      writeFileSync(join(dir, p, "index.html"), html);
    }
    // The server hangs up on headless Chrome, as a bot blocker might; the crawler itself gets the pages.
    const site = await serve(dir, {
      before: req => /HeadlessChrome/.test(req.headers["user-agent"] || "") && (req.socket.destroy(), true),
    });
    try {
      await node([
        join(SCRIPTS, "seo-crawl.mjs"),
        "--url",
        site.url,
        "--site-origin",
        "https://site.example",
        "--outside",
        "--psi-endpoint",
        "http://127.0.0.1:9/runPagespeed",
        "--out",
        out,
      ]);
    } finally {
      await site.close();
    }
    const r = JSON.parse(readFileSync(out, "utf8"));
    assert.ok(
      !r.findings.some(f => f.check.startsWith("render-")),
      JSON.stringify(r.findings.filter(f => f.check.startsWith("render-")).map(f => f.evidence)),
    );
    assert.ok(!r.passed.some(p => p.rule === "REND-06"));
    assert.match(r.notChecked.find(n => n.rule === "REND-06")?.reason || "", /Chrome couldn't load .*net::ERR_/);
  },
);

test(
  "--render all renders every indexable page up to the cap, after the estimate",
  { skip: !browser && "Chrome not installed", timeout: 300000 },
  async () => {
    const o = "https://example.com",
      logged = [];
    const cut = renderAll([`${o}/a/`, `${o}/b/`, `${o}/`, `${o}/c/`], { max: 3, log: m => logged.push(m) });
    assert.deepEqual(cut.urls, [`${o}/`, `${o}/a/`, `${o}/b/`]);
    assert.deepEqual(logged, [
      "Rendering 3 pages in the browser, about 1 minute (roughly 5 seconds a page), one at a time.",
    ]);
    assert.match(cut.note, /stopped at 3 pages.*1 more page/);
    assert.equal(renderAll([`${o}/`]).note, null, "no cut under 200 pages");

    // By default the crawler renders the sample, one page per top-level folder; --render all, every page meant to rank.
    const dir = tmp();
    const page = (title, extra = "") =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${extra}</head><body><main><h1>${title}</h1><p>Boiler repairs and servicing across Leeds, with a written estimate first.</p><a href="/a/1/">One</a> <a href="/a/2/">Two</a> <a href="/a/3/">Three</a> <a href="/a/hidden/">Hidden</a></main></body></html>`;
    const pages = {
      "/": page("Boiler Repairs in Leeds"),
      "/a/1/": page("Boiler Servicing in Leeds"),
      "/a/2/": page("Boiler Installation in Leeds"),
      "/a/3/": page("Gas Safety Checks in Leeds"),
      "/a/hidden/": page("Hidden Page for Staff", '<meta name="robots" content="noindex">'),
    };
    for (const [p, html] of Object.entries(pages)) {
      mkdirSync(join(dir, p), { recursive: true });
      writeFileSync(join(dir, p, "index.html"), html);
    }
    const crawlRendering = async (...extra) => {
      const rendered = new Set(),
        out = join(tmp(), "crawl.json");
      // --dump-dom loads pages with headless Chrome's own user agent; the phone and desktop loads set their own.
      const site = await serve(dir, {
        before: req => {
          if (/HeadlessChrome/.test(req.headers["user-agent"] || "") && req.url.endsWith("/")) rendered.add(req.url);
          return false;
        },
      });
      let stdout;
      try {
        ({ stdout } = await node([
          join(SCRIPTS, "seo-crawl.mjs"),
          "--url",
          site.url,
          "--site-origin",
          "https://site.example",
          "--outside",
          "--psi-endpoint",
          "http://127.0.0.1:9/runPagespeed",
          "--out",
          out,
          ...extra,
        ]));
      } finally {
        await site.close();
      }
      return { rendered: [...rendered].sort(), stdout, r: JSON.parse(readFileSync(out, "utf8")) };
    };
    const sample = await crawlRendering();
    assert.equal(sample.rendered.length, 2, sample.rendered.join(" "));
    assert.equal(sample.rendered[0], "/");
    assert.doesNotMatch(sample.stdout, /Rendering \d+ page/);
    const all = await crawlRendering("--render", "all");
    assert.deepEqual(all.rendered, ["/", "/a/1/", "/a/2/", "/a/3/"], "every page meant to rank, not the noindex one");
    assert.match(all.stdout, /Rendering 4 pages in the browser, about 1 minute/);
    assert.ok(
      all.r.notes.some(n => /^Rendered 4 of 4 page\(s\)/.test(n)),
      all.r.notes.join("\n"),
    );
    assert.ok(all.r.passed.some(p => p.rule === "REND-06"));
  },
);
