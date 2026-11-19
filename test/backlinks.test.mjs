import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { serve } from "./serve.mjs";
import { checkBacklinks } from "../skills/seo-supervisor/scripts/backlinks.mjs";

const CLI = join(SCRIPTS, "backlinks.mjs");
const SITE = "https://www.example.com";
const html = body => ({ type: "text/html; charset=utf-8", body: `<!doctype html><title>t</title>${body}` });

// One local server plays every linking site. hits: each request's path and user agent; most: peak requests in flight.
async function sites(files = {}, { status = {}, redirects = {}, hold = 0 } = {}) {
  const hits = [];
  let now = 0,
    most = 0;
  const srv = await serve(tmp(), {
    files,
    before(req, res) {
      const path = new URL(req.url, "http://x").pathname;
      hits.push({ path, ua: req.headers["user-agent"] });
      if (path === "/slow") return true; // never answers
      if (status[path]) {
        res.writeHead(status[path]).end();
        return true;
      }
      if (redirects[path]) {
        res.writeHead(301, { Location: redirects[path] }).end();
        return true;
      }
      if (!hold) return false;
      most = Math.max(most, ++now);
      setTimeout(() => {
        now--;
        res.writeHead(200, { "Content-Type": "text/html" }).end(`<a href="${SITE}/">us</a>`);
      }, hold);
      return true;
    },
  });
  return { ...srv, hits, most: () => most };
}
const anyAddress = { allow: async () => true };

test("a link to any page of the site counts, www or not and http or https; nofollow, sponsored and ugc are recorded", async () => {
  const srv = await sites({
    "/a": html(`<p><a class="x" href="http://example.com/old-page">us</a></p>`),
    "/b": html(`<a rel="nofollow sponsored" href='https://www.example.com/'>us</a>`),
    "/c": html(`<a rel="ugc" href="https://example.com/">one</a> <a href="https://www.example.com/pricing">two</a>`),
  });
  try {
    const { backlinks, findings } = await checkBacklinks(
      [srv.url + "/a", srv.url + "/b", srv.url + "/c"],
      SITE,
      anyAddress,
    );
    assert.equal(backlinks.checked, 3);
    assert.equal(backlinks.live, 3);
    assert.deepEqual(backlinks.gone, []);
    assert.deepEqual(backlinks.unreachable, []);
    assert.deepEqual(
      backlinks.nofollow,
      [{ url: srv.url + "/b", rel: "nofollow sponsored" }],
      "a page with one followed link isn't nofollow",
    );
    assert.ok(!isNaN(Date.parse(backlinks.when)));
    assert.deepEqual(findings, []);
    assert.ok(
      srv.hits.every(h => h.ua === "seo-supervisor-backlinks"),
      "a clear user agent",
    );
  } finally {
    await srv.close();
  }
});

// Enough text to read as a real article.
const ARTICLE = `<p>${"A long post about something else entirely, with enough words to read like a real page. ".repeat(6)}</p>`;

test("gone means the page loads without a link, or answers 404 or 410, and the reason says which", async () => {
  const srv = await sites(
    {
      "/nolink": html(
        `${ARTICLE}<a href="https://shop.example.com/">a subdomain</a> <a href="https://notexample.com/">another site</a>`,
      ),
    },
    { status: { "/404": 404, "/410": 410 } },
  );
  try {
    const { backlinks, findings } = await checkBacklinks(
      [srv.url + "/nolink", srv.url + "/404", srv.url + "/410"],
      SITE,
      anyAddress,
    );
    assert.equal(backlinks.live, 0);
    assert.deepEqual(
      backlinks.gone.map(g => g.url),
      [srv.url + "/nolink", srv.url + "/404", srv.url + "/410"],
    );
    const [nolink, nf, removed] = backlinks.gone.map(g => g.reason);
    assert.match(nolink, /loads but no longer links to your site/);
    assert.match(nf, /404/);
    assert.match(removed, /410/);
    assert.equal(findings.length, 1);
    const f = findings[0];
    assert.equal(f.check, "backlinks-gone");
    assert.equal(f.severity, "low");
    assert.equal(f.rule, "LAUNCH-05");
    assert.equal(f.count, 3);
    assert.deepEqual(
      f.evidence.map(e => e.url),
      backlinks.gone.map(g => g.url),
    );
    assert.equal(f.evidence[1].detail, nf);
    assert.match(f.fix, /ask the site/i);
    assert.match(f.fix, /redirect/i);
  } finally {
    await srv.close();
  }
});

test("a page that fails to load is 'couldn't check', never gone", async () => {
  const srv = await sites(
    { "/file.pdf": { type: "application/pdf", body: "%PDF-1.4" } },
    { status: { "/403": 403, "/503": 503 } },
  );
  try {
    const urls = ["/403", "/503", "/slow", "/file.pdf"].map(p => srv.url + p);
    const { backlinks, findings } = await checkBacklinks([...urls, "http://127.0.0.1:1/"], SITE, {
      ...anyAddress,
      timeout: 300,
    });
    assert.equal(backlinks.checked, 5);
    assert.deepEqual(backlinks.gone, []);
    assert.deepEqual(findings, []);
    const why = Object.fromEntries(backlinks.unreachable.map(u => [u.url, u.reason]));
    assert.match(why[urls[0]], /403/);
    assert.match(why[urls[1]], /503/);
    assert.match(why[urls[2]], /no answer within 0\.3 seconds/);
    assert.match(why[urls[3]], /application\/pdf/);
    assert.match(why["http://127.0.0.1:1/"], /couldn't connect/);
  } finally {
    await srv.close();
  }
});

test("a huge page is read only up to 5 MB, and one that doesn't say what it is is read as a page only when it looks like one", async () => {
  let sent = 0;
  const MB = 1024 * 1024,
    chunk = Buffer.alloc(64 * 1024, "words and ");
  const srv = await serve(tmp(), {
    before(req, res) {
      const path = new URL(req.url, "http://x").pathname;
      if (path === "/sniffed") {
        res.writeHead(200).end(`<!DOCTYPE html><a href="${SITE}/">us</a>`);
        return true;
      }
      res.writeHead(200, path === "/big.html" ? { "Content-Type": "text/html" } : {}).on("error", () => {});
      res.write(path === "/big.html" ? `<!doctype html><title>t</title><p>` : "");
      let left = 64 * MB;
      const pump = () => {
        while (left > 0 && !res.destroyed) {
          left -= chunk.length;
          sent += chunk.length;
          if (!res.write(chunk)) return;
        }
        res.end();
      };
      res.on("drain", pump);
      pump();
      return true;
    },
  });
  try {
    const urls = ["/untyped", "/big.html", "/sniffed"].map(p => srv.url + p);
    const { backlinks } = await checkBacklinks(urls, SITE, anyAddress);
    assert.equal(backlinks.live, 1, "a page without a type that starts like HTML is read");
    assert.deepEqual(backlinks.gone, []);
    const why = Object.fromEntries(backlinks.unreachable.map(u => [u.url, u.reason]));
    assert.match(why[urls[0]], /didn't say what kind of file it is/);
    assert.match(why[urls[1]], /only its first 5 MB were read/);
    assert.ok(sent < 40 * MB, `stopped reading early (${Math.round(sent / MB)} MB sent)`);
  } finally {
    await srv.close();
  }
});

test("a name is checked at the address the visit connects to: a private answer, a mapped or reserved one, or a failed lookup isn't visited", async () => {
  const srv = await sites({ "/": html(`<a href="${SITE}/">us</a>`) }),
    port = new URL(srv.url).port;
  const answers = {
    "rebind.example": "127.0.0.1",
    "mapped.example": "::ffff:127.0.0.1",
    "nat64.example": "64:ff9b::7f00:1",
    "bench.example": "198.19.0.1",
    "multicast.example": "224.0.0.1",
    "reserved.example": "240.0.0.1",
    "broadcast.example": "255.255.255.255",
  };
  const asked = [];
  // Stands in for DNS: answers what a name changed to after the address check, the way rebinding does.
  const dns = (name, opts, cb) => {
    asked.push(name);
    const a = answers[name],
      family = a?.includes(":") ? 6 : 4;
    if (!a) return cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${name}`), { code: "ENOTFOUND" }));
    opts.all ? cb(null, [{ address: a, family }]) : cb(null, a, family);
  };
  try {
    const urls = [...Object.keys(answers), "nowhere.example"].map(h => `http://${h}:${port}/`);
    const { backlinks } = await checkBacklinks(urls, SITE, { dns, timeout: 3000 });
    assert.equal(srv.hits.length, 0, "nothing reached the local server");
    assert.equal(backlinks.live + backlinks.gone.length, 0);
    assert.deepEqual(
      [...new Set(asked)].sort(),
      urls.map(u => new URL(u).hostname).sort(),
      "each name is looked up for the connection itself",
    );
    const why = Object.fromEntries(backlinks.unreachable.map(u => [new URL(u.url).hostname, u.reason]));
    for (const h of Object.keys(answers))
      assert.match(
        why[h],
        new RegExp(
          `${h.replace(".", "\\.")} points at a private or local address \\(${answers[h].replace(/\./g, "\\.")}\\), so it wasn't visited`,
        ),
      );
    assert.match(why["nowhere.example"], /couldn't connect \(ENOTFOUND\)/);
  } finally {
    await srv.close();
  }
});

test("a page whose links couldn't be read is 'couldn't check', not gone; a link through a redirect wrapper counts", async () => {
  const srv = await sites({
    "/app": html(`<script src="/main.js"></script><div id="root"></div>`),
    "/bare": html(`<noscript>${ARTICLE}</noscript><div class="shell"></div>`),
    "/consent": html(
      `<h1>Before you continue</h1><p>We use cookies and data to deliver and maintain our services, measure audiences and show ads. If you choose Accept all, we will also use cookies to develop new services.</p><form><button>Reject all</button><button>Accept all</button></form><a href="/privacy">Privacy Policy</a>`,
    ),
    "/nolinks": html(ARTICLE),
    "/mention": html(`${ARTICLE}<p>Thanks to www.example.com for the tip.</p><a href="/about">About</a>`),
    "/scripted": html(
      `${ARTICLE}<a href="/about">About</a><!-- <a href="https://example.com/">commented out</a> --><script>var s = '<a href="https://example.com/">';</script>`,
    ),
    "/wrapped": html(
      `${ARTICLE}<a rel="nofollow" href="https://www.youtube.com/redirect?event=video&amp;q=https%3A%2F%2Fwww.example.com%2Fpricing">us</a>`,
    ),
    "/wrapped-elsewhere": html(
      `${ARTICLE}<a href="https://l.example.net/out?u=https%3A%2F%2Fother.example%2F&amp;to=not-a-url">them</a>`,
    ),
  });
  try {
    const paths = ["/app", "/bare", "/consent", "/nolinks", "/mention", "/scripted", "/wrapped", "/wrapped-elsewhere"];
    const { backlinks } = await checkBacklinks(
      paths.map(p => srv.url + p),
      SITE,
      anyAddress,
    );
    assert.equal(backlinks.live, 1);
    assert.deepEqual(backlinks.nofollow, [{ url: srv.url + "/wrapped", rel: "nofollow" }], "the wrapper's rel is kept");
    assert.deepEqual(
      backlinks.gone.map(g => g.url),
      [srv.url + "/wrapped-elsewhere"],
      "a wrapper to another site isn't a link",
    );
    const why = Object.fromEntries(backlinks.unreachable.map(u => [new URL(u.url).pathname, u.reason]));
    assert.match(why["/app"], /built by JavaScript/);
    assert.match(why["/bare"], /built by JavaScript/);
    assert.match(why["/consent"], /cookie or privacy consent screen/);
    assert.match(why["/nolinks"], /has no links at all/);
    assert.match(why["/mention"], /mentions example\.com but no link to it was found/);
    assert.match(why["/scripted"], /mentions example\.com but no link to it was found/);
  } finally {
    await srv.close();
  }
});

test("redirects are followed, but never to an address the check refuses", async () => {
  const srv = await sites(
    { "/new": html(`<a href="${SITE}/">us</a>`) },
    { redirects: { "/old": "/new", "/to-private": "http://10.0.0.1/admin" } },
  );
  try {
    const allow = async u => !u.startsWith("http://10.");
    const { backlinks } = await checkBacklinks([srv.url + "/old", srv.url + "/to-private", "http://10.0.0.2/"], SITE, {
      allow,
    });
    assert.equal(backlinks.live, 1);
    const why = Object.fromEntries(backlinks.unreachable.map(u => [u.url, u.reason]));
    assert.match(
      why[srv.url + "/to-private"],
      /redirects to http:\/\/10\.0\.0\.1\/admin, which isn't a public web address/,
    );
    assert.match(why["http://10.0.0.2/"], /isn't a public web address/);
    assert.ok(!srv.hits.some(h => h.path === "/admin"));
  } finally {
    await srv.close();
  }
});

test("politeness: at most 100 pages, 4 at a time, each page once", async () => {
  const srv = await sites({}, { hold: 30 });
  try {
    const urls = Array.from({ length: 105 }, (_, i) => `${srv.url}/p${i}`);
    const { backlinks, notes } = await checkBacklinks([...urls, urls[0] + "#again"], SITE, anyAddress);
    assert.equal(backlinks.checked, 100);
    assert.equal(backlinks.live, 100);
    assert.equal(srv.hits.length, 100);
    assert.equal(srv.most(), 4);
    assert.match(notes.join(" "), /5 more/);
  } finally {
    await srv.close();
  }
});

test("without --yes it's a dry run: it counts the pages per host from Bing, a Search Console export and a list, and visits nothing", async () => {
  const dir = tmp();
  writeFileSync(
    join(dir, "keys.json"),
    JSON.stringify({
      bing: {
        backlinks: {
          pages: [{ url: "https://www.example.com/pricing", count: 9 }],
          sample: [
            { url: "https://blog.example.net/post", anchorText: "Example" },
            { url: "https://blog.example.net/other", anchorText: "" },
            "junk",
            null,
          ],
        },
      },
    }),
  );
  writeFileSync(
    join(dir, "links.csv"),
    "﻿Linking page,Last crawled\r\nhttps://news.example.org/story,2026-11-01\r\nhttps://blog.example.net/post,2026-10-30\r\n",
  );
  writeFileSync(join(dir, "list.txt"), "# links I know about\nhttps://friend.example.io/\n\nhttp://192.168.1.20/\n");
  const out = join(dir, "backlinks.json");
  const r = await node([
    CLI,
    "--site",
    SITE,
    "--keys",
    join(dir, "keys.json"),
    "--csv",
    join(dir, "links.csv"),
    "--urls",
    join(dir, "list.txt"),
    "--out",
    out,
  ]);
  assert.match(r.stdout, /dry run/i);
  assert.match(r.stdout, /would visit 4 page\(s\) on 3 site\(s\)/);
  assert.match(r.stdout, /blog\.example\.net: 2/);
  assert.match(r.stdout, /news\.example\.org: 1/);
  assert.match(r.stdout, /friend\.example\.io: 1/);
  assert.doesNotMatch(
    r.stdout,
    /www\.example\.com\/pricing/,
    "Bing's linked pages are the owner's own pages, not linking pages",
  );
  assert.match(r.stdout, /1 address(es)? isn't public/);
  assert.match(r.stdout, /--yes/);
  assert.ok(!existsSync(out), "a dry run writes nothing");
});

test("a Search Console export in another language is read by its URL column", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "links.csv"), "Página de enlace,Último rastreo\nhttps://diario.example.es/nota,2026-11-01\n");
  const r = await node([CLI, "--site", SITE, "--csv", join(dir, "links.csv")]);
  assert.match(r.stdout, /diario\.example\.es: 1/);
});

test("with --yes a non-public address is refused, not visited, and the result is written", async () => {
  const srv = await sites({ "/": html(`<a href="${SITE}/">us</a>`) }),
    dir = tmp();
  try {
    writeFileSync(join(dir, "list.txt"), srv.url + "/\n");
    const out = join(dir, "backlinks.json");
    const r = await node([CLI, "--site", SITE, "--urls", join(dir, "list.txt"), "--out", out, "--yes"]);
    assert.equal(srv.hits.length, 0, "the owner's own machine and network aren't visited");
    const o = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(o.backlinks.checked, 1);
    assert.equal(o.backlinks.live, 0);
    assert.match(o.backlinks.unreachable[0].reason, /isn't a public web address/);
    assert.deepEqual(o.findings, []);
    assert.match(r.stdout, /0 of 1 known link is still there; 0 gone; 1 couldn't be checked/);
  } finally {
    await srv.close();
  }
});

const render = async edit => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SCRIPTS, "..", "examples", "sample-audit.json"), "utf8"));
  edit(data);
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};
const CHECK = () => ({
  when: "2026-11-19T10:00:00.000Z",
  checked: 20,
  live: 6,
  nofollow: [],
  gone: [
    { url: "https://blog.example/<img src=x onerror=alert(1)>", reason: "the page answered 404: it no longer exists" },
    ...Array.from({ length: 11 }, (_, i) => ({
      url: `https://gone${i + 2}.example/`,
      reason: "the page loads but no longer links to your site",
    })),
  ],
  unreachable: [
    { url: "https://slow.example/", reason: "no answer within 15 seconds" },
    { url: "https://shy.example/", reason: "the site answered 403, turning the visit away" },
  ],
});

test("the report's links section says how many known links are still there and lists the gone ones, escaped", async () => {
  const LINE = "6 of 20 known links are still there; 12 gone; 2 couldn't be checked";
  const { html, md } = await render(d => {
    d.backlinks = CHECK();
  });
  const det = html.match(/<details class="how links">[\s\S]*?<\/details>/)?.[0];
  assert.ok(det, "the collapsed links section shows without Bing data");
  assert.match(det, /<summary>Links from other sites<\/summary>/, "not labelled Bing when there's no Bing data");
  assert.ok(det.includes(`<p>${LINE.replace("'", "&#39;")}</p>`));
  assert.ok(
    det.includes(
      "<li><b><code>https://blog.example/&lt;img src=x onerror=alert(1)&gt;</code></b><span>the page answered 404: it no longer exists</span></li>",
    ),
  );
  assert.ok(det.includes("gone10.example") && !det.includes("gone11.example"), "the first 10 gone links");
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(md, /^## Links from other sites$/m);
  assert.ok(md.includes(`\n${LINE}\n`));
  assert.ok(
    md.includes("\n- `https://blog.example/<img src=x onerror=alert(1)>` the page answered 404: it no longer exists\n"),
    "URLs in code spans",
  );
  assert.ok(md.includes("gone10.example") && !md.includes("gone11.example"));

  const both = await render(d => {
    d.backlinks = CHECK();
    d.bing = { backlinks: { pages: [{ url: "https://security.example/", count: 4 }], sample: [] } };
  });
  assert.match(both.html, /<summary>Links from other sites \(Bing\)<\/summary><p>6 of 20/);
  assert.ok(both.html.includes("<span>4 links</span>"), "Bing's lists stay");

  const none = await render(() => {});
  for (const junk of [
    { checked: "x", gone: "y" },
    { checked: 0, gone: [], unreachable: [] },
    "nope",
    { checked: 2, live: 1, gone: [null, 7], unreachable: {} },
  ]) {
    const r = await render(d => {
      d.backlinks = junk;
    });
    if (junk.checked === 2) {
      assert.ok(
        r.html.includes("<p>1 of 2 known links are still there; 0 gone; 0 couldn&#39;t be checked</p>"),
        "junk entries are dropped",
      );
      continue;
    }
    assert.equal(r.html, none.html, `junk ${JSON.stringify(junk)} adds nothing`);
    assert.equal(r.md, none.md);
  }
});

test("a linking page's address can't become a link with made-up text in the Markdown report", async () => {
  const PHISH = "/[Verify your account](https://phish.example/)";
  const srv = await sites({}, { status: { [new URL("http://x" + PHISH).pathname]: 404 } });
  try {
    const { backlinks, findings } = await checkBacklinks([srv.url + PHISH], SITE, anyAddress);
    assert.equal(findings.length, 1);
    const evil = "https://evil.example/[Verify your account](https://phish.example/)";
    const other = {
      id: "X-001",
      check: "x",
      rule: "LAUNCH-05",
      severity: "low",
      category: "Launch & monitoring",
      title: "Another check",
      what: "w",
      why: "y",
      fix: "f",
      status: "open",
      count: 2,
      evidence: [
        { url: evil, detail: `it now redirects to ${evil}, see \`kept | code\` <img src=x onerror=alert(1)>` },
        { url: "https://ok.example/a|b", detail: "[Verify](https://phish.example/)" },
      ],
    };
    const { md } = await render(d => {
      d.backlinks = backlinks;
      d.findings.push(...findings, other);
    });
    assert.ok(
      md.includes(
        `**What's wrong.** Found on \`${srv.url}/[Verify%20your%20account](https://phish.example/)\` (the page answered 404: it no longer exists).`,
      ),
      "the address in the finding is a code span",
    );
    assert.doesNotMatch(
      md.replace(/`[^`\n]*`/g, ""),
      /phish\.example/,
      "outside code spans phish.example never appears, so it can't be a link",
    );
    assert.ok(
      md.includes(
        "| `https://evil.example/[Verify your account](https://phish.example/)` | it now redirects to `https://evil.example/[Verify` your account\\](`https://phish.example/`), see `kept \\| code` \\<img src=x onerror=alert(1)\\> |",
      ),
      "the agent's own code spans stay",
    );
    assert.ok(
      md.includes("| `https://ok.example/a\\|b` | \\[Verify\\](`https://phish.example/`) |"),
      "a | can't split the table",
    );
  } finally {
    await srv.close();
  }
});

test("bad input exits 2 with a message", async () => {
  await assert.rejects(node([CLI, "--site", SITE]), e => e.code === 2 && /usage/.test(e.stderr));
  await assert.rejects(
    node([CLI, "--site", "example", "--urls", "x.txt"]),
    e => e.code === 2 && /--site/.test(e.stderr),
  );
  const dir = tmp();
  writeFileSync(join(dir, "links.csv"), "Name,Count\nfoo,1\n");
  await assert.rejects(
    node([CLI, "--site", SITE, "--csv", join(dir, "links.csv")]),
    e => e.code === 2 && /Linking page/.test(e.stderr),
  );
});
