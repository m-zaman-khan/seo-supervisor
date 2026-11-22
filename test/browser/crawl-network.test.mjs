// @ts-check
// One Chrome per crawl: the renders and the phone and desktop loads share one browser, and every browser check runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "../serve.mjs";
import { SCRIPTS, node, tmp } from "../helpers.mjs";
import { findBrowser } from "../../skills/seo-supervisor/scripts/checks/render.mjs";

// Counts browser starts in the crawler's process: spawn and execFile both end in ChildProcess.prototype.spawn.
const COUNT =
  "data:text/javascript," +
  encodeURIComponent(`import cp from "node:child_process"; import { writeFileSync } from "node:fs";
const proto = cp.ChildProcess.prototype, spawn = proto.spawn; let n = 0;
proto.spawn = function (o) { if (/(chrome|msedge|chromium)[^\\\\/]*$/i.test(String(o.file))) n++; return spawn.call(this, o); };
process.on("exit", () => { if (process.env.NET_CHROME_FILE) writeFileSync(process.env.NET_CHROME_FILE, String(n)); });`);
const COPY =
  "Our engineers repair boilers, radiators, pumps and leaking pipes across Leeds, Bradford, Harrogate and York. Every visit starts with a written estimate and honest advice about replacement versus repair.";
const page = (title, body = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><header><nav><a href="/">Home</a></nav></header><main><h1>${title}</h1><p>${COPY}</p>${body}</main></body></html>`;

test(
  "a crawl with --outside starts Chrome once for the renders and the phone and desktop checks of 10 pages",
  { timeout: 600000 },
  async t => {
    const browser = findBrowser();
    if (!browser) return t.skip("no Chrome or Edge here");
    const dir = tmp(),
      out = join(tmp(), "crawl.json"),
      count = join(tmp(), "starts.txt");
    const folders = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const pages = {
      "/": page("Boiler repairs in Leeds", folders.map(f => `<a href="/${f}/">Service ${f}</a>`).join(" ")),
      ...Object.fromEntries(folders.map(f => [`/${f}/`, page(`Service ${f}`, `<a href="/">Home</a>`)])),
    };
    for (const [p, html] of Object.entries(pages)) {
      mkdirSync(join(dir, p), { recursive: true });
      writeFileSync(join(dir, p, "index.html"), html);
    }
    writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
    const site = await serve(dir),
      t0 = Date.now();
    try {
      await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, "--outside", "--out", out], {
        env: {
          ...process.env,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${COUNT}`.trim(),
          NET_CHROME_FILE: count,
          PSI_API_KEY: "",
          CRUX_API_KEY: "",
        },
      });
    } finally {
      await site.close();
    }
    const r = JSON.parse(readFileSync(out, "utf8")),
      starts = Number(readFileSync(count, "utf8"));
    t.diagnostic(`Chrome starts: ${starts}, wall ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    assert.equal(starts, 1);
    assert.ok(
      r.notes.some(n => /^Rendered 10 of 10 sample page\(s\)/.test(n)),
      r.notes.join("\n"),
    );
    for (const rule of ["REND-06", "REND-07", "REND-11"])
      assert.ok(
        !r.notChecked.some(n => n.rule === rule),
        `${rule}: ${JSON.stringify(r.notChecked.find(n => n.rule === rule))}`,
      );
    assert.equal(r.renderSample?.length, 10);
  },
);
