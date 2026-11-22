// @ts-check
// Render network guards in real Chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { findBrowser, openSession, renderPage } from "../../skills/seo-supervisor/scripts/checks/render.mjs";
import { checkVisual } from "../../skills/seo-supervisor/scripts/checks/visual.mjs";

const listen = (server, host = "127.0.0.1") =>
  new Promise((ok, fail) => server.once("error", fail).listen(0, host, () => ok(server.address().port)));

// A page on the site that reaches for another loopback address (a stand-in for a private or metadata address: both are
// outside the site's own) and for the site's own address on another port, and registers a service worker.
const browser = findBrowser();
test(
  "headless Chrome renders and phone loads can't reach addresses outside the site, and service workers are off in the loads",
  { skip: !browser && "Chrome not installed", timeout: 600000 },
  async t => {
    const hits = { other: 0, own: 0, sw: 0 };
    const other = createServer((q, s) => {
      hits.other++;
      s.end();
    });
    try {
      await listen(other, "127.0.0.2");
    } catch {
      return t.skip("no second loopback address here (macOS)");
    }
    const own = createServer((q, s) => {
        hits.own++;
        s.writeHead(200, { "content-type": "image/gif" }).end();
      }),
      ownPort = await listen(own);
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Guarded</title></head><body><main><h1>Guarded</h1><p>${"Boiler repairs across Leeds. ".repeat(20)}</p>
<img src="http://127.0.0.2:${other.address().port}/pixel.gif" alt=""><img src="http://localhost:${ownPort}/own.gif" alt="">
<script>fetch("http://127.0.0.2:${other.address().port}/fetch", { mode: "no-cors" }).catch(() => {}); if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");</script></main></body></html>`;
    const site = createServer((q, s) => {
      if (q.url === "/sw.js") {
        hits.sw++;
        s.writeHead(200, { "content-type": "text/javascript" }).end("");
      } else s.writeHead(200, { "content-type": "text/html" }).end(html);
    });
    const sitePort = await listen(site),
      url = `http://127.0.0.1:${sitePort}/`;
    try {
      const dom = await renderPage(browser, url, { timeoutMs: 180000 }); // a busy machine starts Chrome slowly
      assert.match(dom, /<h1>Guarded<\/h1>/);
      assert.equal(hits.other, 0, "the render reached another address");
      assert.ok(hits.own >= 1, "the site's own address on another port still loads");
      hits.own = 0;
      hits.sw = 0;
      const v = await checkVisual(browser, [url], { add: () => {}, pageBudgetMs: 240000 });
      assert.equal(v.checked, 1, v.notes.join(" "));
      assert.equal(hits.other, 0, "a phone or desktop load reached another address");
      assert.ok(hits.own >= 1);
      assert.equal(hits.sw, 0, "no service worker was registered");
      // A render in an open session (an isolated tab) is guarded the same way, and so are the loads that share it.
      hits.own = 0;
      const session = await openSession(browser, url);
      try {
        assert.match(await renderPage(browser, url, { timeoutMs: 180000 }, session), /<h1>Guarded<\/h1>/);
      } finally {
        await session.close();
      }
      assert.equal(hits.other, 0, "a render in the session reached another address");
      assert.ok(hits.own >= 1);
      assert.equal(hits.sw, 0, "no service worker was registered in the session");
    } finally {
      site.close();
      own.close();
      other.close();
    }
  },
);
