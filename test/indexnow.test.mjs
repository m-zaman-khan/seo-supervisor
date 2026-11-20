import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { serve } from "./serve.mjs";

const CLI = join(SCRIPTS, "indexnow.mjs");
const KEY = "0123456789abcdef0123456789abcdef";

// One local server plays both the site (serving the key file and sitemaps) and the IndexNow endpoint.
async function fake({ files = {}, status = 202 } = {}) {
  const hits = [],
    posts = [];
  const srv = await serve(tmp(), {
    files,
    before(req, res) {
      hits.push(req.method + " " + req.url);
      if (req.method !== "POST") return false;
      let body = "";
      req.on("data", c => {
        body += c;
      });
      req.on("end", () => {
        posts.push(JSON.parse(body));
        res.writeHead(status).end();
      });
      return true;
    },
  });
  return { ...srv, hits, posts, endpoint: srv.url + "/indexnow" };
}
const keyFile = { [`/${KEY}.txt`]: { type: "text/plain", body: KEY } };
const urlsFile = (dir, lines) => {
  const f = join(dir, "urls.txt");
  writeFileSync(f, lines.join("\n") + "\n");
  return f;
};
const submit = (srv, dir, extra) =>
  node([
    CLI,
    "submit",
    "--site",
    srv.url,
    "--key",
    KEY,
    "--endpoint",
    srv.endpoint,
    "--out",
    join(dir, "indexnow.json"),
    ...extra,
  ]);
const summary = (dir, name = "indexnow.json") => JSON.parse(readFileSync(join(dir, name), "utf8"));
const dryRun = dir => summary(dir, "indexnow-dryrun.json");

test("key: creates a 32-character key file, then reuses it instead of making another", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\n");
  const first = await node([CLI, "key", "--public-dir", dir, "--site", "https://www.example.com"]);
  const key = first.stdout.match(/\b[a-f0-9]{32}\b/)[0];
  assert.equal(readFileSync(join(dir, `${key}.txt`), "utf8"), key);
  assert.match(first.stdout, new RegExp(`https://www\\.example\\.com/${key}\\.txt`));
  const again = await node([CLI, "key", "--public-dir", dir]);
  assert.match(again.stdout, new RegExp(key));
  assert.deepEqual(readdirSync(dir).sort(), [`${key}.txt`, "robots.txt"].sort(), "no second key file");
});

test("key: an existing key file in the IndexNow format is reused, whatever its length", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "my-key-1234.txt"), "my-key-1234\n");
  const r = await node([CLI, "key", "--public-dir", dir]);
  assert.match(r.stdout, /my-key-1234/);
  assert.deepEqual(readdirSync(dir), ["my-key-1234.txt"]);
});

test("submit without --yes is a dry run: it prints the request and sends nothing", async () => {
  const srv = await fake({ files: keyFile }),
    dir = tmp();
  try {
    const r = await submit(srv, dir, ["--urls", urlsFile(dir, [srv.url + "/a/", "/b/"])]);
    assert.equal(srv.hits.length, 0, "no request at all, not even the key check");
    assert.match(r.stdout, /dry run/i);
    assert.match(r.stdout, /--yes/);
    const s = dryRun(dir);
    assert.equal(s.sent, false);
    assert.deepEqual(s.urls, [srv.url + "/a/", srv.url + "/b/"]);
  } finally {
    await srv.close();
  }
});

test("a dry run after a real send leaves the send's summary alone", async () => {
  const srv = await fake({ files: keyFile }),
    dir = tmp();
  try {
    await submit(srv, dir, ["--yes", "--urls", urlsFile(dir, ["/a/"])]);
    await submit(srv, dir, ["--urls", urlsFile(dir, ["/b/"])]);
    assert.equal(summary(dir).sent, true);
    assert.deepEqual(summary(dir).urls, [srv.url + "/a/"]);
    assert.deepEqual(dryRun(dir).urls, [srv.url + "/b/"]);
  } finally {
    await srv.close();
  }
});

test("--urls lines that start with a host are URLs without their scheme, not paths", async () => {
  const dir = tmp();
  await node([
    CLI,
    "submit",
    "--site",
    "https://www.example.com",
    "--key",
    KEY,
    "--out",
    join(dir, "indexnow.json"),
    "--urls",
    urlsFile(dir, ["www.example.com/about", "www.example.com", "/x/", "page.html", "docs/setup"]),
  ]);
  assert.deepEqual(dryRun(dir).urls, [
    "https://www.example.com/about",
    "https://www.example.com/",
    "https://www.example.com/x/",
    "https://www.example.com/page.html",
    "https://www.example.com/docs/setup",
  ]);
});

test("submit --yes fails when the key file redirects to another host, and names the host to use", async () => {
  const posts = [];
  const srv = await serve(tmp(), {
    before(req, res) {
      if (req.method === "POST") {
        posts.push(req.url);
        res.writeHead(202).end();
        return true;
      }
      // 127.0.0.1 redirects to localhost (another host), which serves the key.
      if (req.headers.host.startsWith("127.0.0.1"))
        res.writeHead(301, { location: `http://localhost:${new URL(srv.url).port}${req.url}` }).end();
      else res.writeHead(200, { "content-type": "text/plain" }).end(KEY);
      return true;
    },
  });
  const dir = tmp(),
    port = new URL(srv.url).port;
  try {
    await assert.rejects(
      submit({ ...srv, endpoint: srv.url + "/indexnow" }, dir, ["--yes", "--urls", urlsFile(dir, ["/a/"])]),
      e =>
        e.code === 2 &&
        e.stderr.includes(`your site answers at localhost:${port}; use --site http://localhost:${port}`),
    );
    assert.equal(posts.length, 0);
  } finally {
    await srv.close();
  }
});

test("key: the help points at the committed folder served at the site root, not the build output", async () => {
  await assert.rejects(
    node([CLI, "key", "--public-dir", join(tmp(), "missing")]),
    e =>
      e.code === 2 && /public\//.test(e.stderr) && /committed/.test(e.stderr) && !/or the build output/.test(e.stderr),
  );
});

test("submit --yes checks the key file, then posts host, key, keyLocation and only this host's URLs", async () => {
  const srv = await fake({ files: keyFile }),
    dir = tmp();
  try {
    const r = await submit(srv, dir, [
      "--yes",
      "--urls",
      urlsFile(dir, [srv.url + "/a/", "https://other.example/x/", srv.url + "/a/#top", "", "# a comment", "/b/"]),
    ]);
    assert.equal(srv.hits[0], `GET /${KEY}.txt`, "the key file is checked first");
    assert.equal(srv.posts.length, 1);
    assert.deepEqual(srv.posts[0], {
      host: new URL(srv.url).host,
      key: KEY,
      keyLocation: `${srv.url}/${KEY}.txt`,
      urlList: [srv.url + "/a/", srv.url + "/b/"],
    });
    assert.match(r.stdout, /202/);
    assert.match(r.stdout, /other host/i, "says what it dropped");
    const s = summary(dir);
    assert.equal(s.sent, true);
    assert.equal(s.count, 2);
    assert.ok(Date.parse(s.when));
    assert.equal(s.batches[0].status, 202);
  } finally {
    await srv.close();
  }
});

test("submit --yes sends batches of 10,000 URLs", async () => {
  const srv = await fake({ files: keyFile, status: 200 }),
    dir = tmp();
  try {
    await submit(srv, dir, [
      "--yes",
      "--urls",
      urlsFile(
        dir,
        Array.from({ length: 10001 }, (_, i) => `/p/${i}`),
      ),
    ]);
    assert.deepEqual(
      srv.posts.map(p => p.urlList.length),
      [10000, 1],
    );
    assert.deepEqual(
      summary(dir).batches.map(b => [b.urls, b.status]),
      [
        [10000, 200],
        [1, 200],
      ],
    );
  } finally {
    await srv.close();
  }
});

test("submit --yes fails clearly when the key file isn't deployed, and posts nothing", async () => {
  const srv = await fake(),
    dir = tmp();
  try {
    await assert.rejects(
      submit(srv, dir, ["--yes", "--urls", urlsFile(dir, ["/a/"])]),
      e => e.code === 2 && /key file/i.test(e.stderr) && /404/.test(e.stderr),
    );
    assert.equal(srv.posts.length, 0);
  } finally {
    await srv.close();
  }
});

test("a refused batch is explained in plain words and exits non-zero", async () => {
  const srv = await fake({ files: keyFile, status: 403 }),
    dir = tmp();
  try {
    await assert.rejects(
      submit(srv, dir, ["--yes", "--urls", urlsFile(dir, ["/a/"])]),
      e => /403/.test(e.stdout) && /key file isn't reachable or doesn't match/.test(e.stdout),
    );
    assert.equal(summary(dir).batches[0].status, 403);
  } finally {
    await srv.close();
  }
});

test("--from-diff takes regressions, improvements, changes and added pages, but not removed ones or pages that now fail", async () => {
  const srv = await fake(),
    dir = tmp(),
    diff = join(dir, "seo-diff.json");
  writeFileSync(
    diff,
    JSON.stringify({
      regressions: [
        { path: "/r/", kind: "noindex-added" },
        { path: "/now-500/", kind: "status-error", before: 200, after: 500 },
      ],
      improvements: [
        { path: "/i/", kind: "h1-added" },
        { path: "/r/", kind: "schema-added" },
      ],
      changed: [{ path: "/c/?page=2", kind: "title-changed" }],
      added: ["/new/"],
      removed: ["/gone/"],
    }),
  );
  try {
    await submit(srv, dir, ["--from-diff", diff]);
    assert.deepEqual(
      dryRun(dir).urls,
      ["/i/", "/r/", "/c/?page=2", "/new/"].map(p => srv.url + p),
      "/r/ for its new schema, not for going noindex",
    );
  } finally {
    await srv.close();
  }
});

test("--from-diff leaves out robots.txt and pages whose links or sitemap listing changed but not the page", async () => {
  const srv = await fake(),
    dir = tmp(),
    diff = join(dir, "seo-diff.json");
  writeFileSync(
    diff,
    JSON.stringify({
      regressions: [
        { path: "/a/", kind: "lost-internal-links" },
        { path: "/b/", kind: "left-sitemap" },
        { path: "/c/", kind: "content-shrunk" },
        { path: "/s/", kind: "speed-slower" },
      ],
      improvements: [
        { path: "/d/", kind: "joined-sitemap" },
        { path: "/e/", kind: "canonical-changed" },
        { path: "/f/", kind: "schema-fields-added" },
      ],
      changed: [
        { path: "/robots.txt", kind: "robots-changed" },
        { path: "/g/", kind: "redirect-added" },
        { path: "/h/", kind: "description-changed" },
      ],
      added: ["/new/"],
    }),
  );
  try {
    await submit(srv, dir, ["--from-diff", diff]);
    assert.deepEqual(
      dryRun(dir).urls,
      ["/c/", "/e/", "/f/", "/g/", "/h/", "/new/"].map(p => srv.url + p),
    );
  } finally {
    await srv.close();
  }
});

test("--from-diff with a real seo-diff leaves out new URLs from the crawl's error list", async () => {
  const srv = await fake(),
    dir = tmp(),
    P = url => ({ url, status: 200, title: url, h1: 1, schema: [] });
  writeFileSync(join(dir, "old.json"), JSON.stringify({ pages: [P("https://e.com/a/")] }));
  writeFileSync(
    join(dir, "new.json"),
    JSON.stringify({
      pages: [P("https://e.com/a/"), P("https://e.com/new/")],
      errors: [{ url: "https://e.com/broken/", status: 404 }],
    }),
  );
  try {
    await node([
      join(SCRIPTS, "seo-diff.mjs"),
      join(dir, "old.json"),
      join(dir, "new.json"),
      "--out",
      join(dir, "seo-diff.json"),
    ]);
    await submit(srv, dir, ["--from-diff", join(dir, "seo-diff.json")]);
    assert.deepEqual(dryRun(dir).urls, [srv.url + "/new/"]);
  } finally {
    await srv.close();
  }
});

test("--from-sitemap reads <loc>s and follows a sitemap index one level", async () => {
  const xml = body => ({ type: "application/xml", body });
  // The port is only known once the server listens; serve() reads `files` per request, so fill it in after.
  const hold = { files: {} },
    live = await fake(hold),
    u = live.url,
    dir = tmp();
  hold.files["/sitemap.xml"] = xml(
    `<?xml version="1.0"?><sitemapindex><sitemap><loc>${u}/s1.xml</loc></sitemap><sitemap><loc>${u}/s2.xml</loc></sitemap></sitemapindex>`,
  );
  hold.files["/s1.xml"] = xml(
    `<urlset><url><loc>${u}/a/</loc><lastmod>2026-11-01</lastmod></url><url><loc> ${u}/b/?x=1&amp;y=2 </loc></url></urlset>`,
  );
  hold.files["/s2.xml"] = xml(
    `<urlset><url><loc>https://cdn.example/c/</loc></url><url><loc>${u}/a/</loc></url></urlset>`,
  );
  try {
    await submit(live, dir, ["--from-sitemap", u + "/sitemap.xml"]);
    assert.deepEqual(dryRun(dir).urls, [u + "/a/", u + "/b/?x=1&y=2"]);
    assert.ok(
      live.hits.every(h => h.startsWith("GET ")),
      "reading the sitemap is the only traffic in a dry run",
    );
  } finally {
    await live.close();
  }
});

test("bad input fails with exit code 2", async () => {
  const dir = tmp();
  await assert.rejects(
    node([CLI, "submit", "--site", "https://www.example.com", "--key", "short", "--urls", urlsFile(dir, ["/a/"])]),
    e => e.code === 2 && /key/i.test(e.stderr),
  );
  await assert.rejects(
    node([CLI, "submit", "--site", "https://www.example.com", "--key", KEY]),
    e => e.code === 2 && /usage/i.test(e.stderr),
  );
  await assert.rejects(node([CLI, "key", "--public-dir", join(dir, "missing")]), e => e.code === 2);
});
