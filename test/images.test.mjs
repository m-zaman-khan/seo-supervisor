// Images (PERF-08): the crawl's image list with a rough saving, the report's table, and images.mjs's conversions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { estSaving } from "../skills/seo-supervisor/scripts/images.mjs";

const IMAGES = join(SCRIPTS, "images.mjs");
const KB = 1024;
// Just enough of each format's header to carry the pixel size, padded to the weight wanted.
const pad = (b, n) => Buffer.concat([b, Buffer.alloc(n - b.length)]);
const png = (w, h, n) => {
  const b = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(b);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return pad(b, n);
};
const jpeg = (w, h, n) => {
  const app0 = Buffer.alloc(18),
    sof = Buffer.alloc(19);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(16, 2);
  sof.writeUInt16BE(0xffc2, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  return pad(Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]), n);
};
const webp = (w, h, n) => {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "latin1");
  b.write("WEBP", 8, "latin1");
  b.write("VP8X", 12, "latin1");
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return pad(b, n);
};

test("the rough saving: WebP's low end for JPEG and PNG, and resizing by pixels past the maximum width", () => {
  assert.equal(estSaving({ bytes: 1000, width: 800, format: "jpeg" }), 250, "lossy WebP is 25–34% smaller than JPEG");
  assert.equal(estSaving({ bytes: 1000, width: 800, format: "png" }), 260, "lossless WebP is 26% smaller than PNG");
  assert.equal(estSaving({ bytes: 1000, width: 800, format: "webp" }), 0, "already modern");
  assert.equal(estSaving({ bytes: 1000, width: null, format: "svg" }), 0);
  assert.equal(
    estSaving({ bytes: 1000, width: 3200, format: "webp" }),
    750,
    "half the width is a quarter of the pixels",
  );
  assert.equal(estSaving({ bytes: 1000, width: 3200, format: "jpeg" }, 3200), 250, "--max-width moves the limit");
});

let crawled;
const imageSite = () =>
  (crawled ||= (async () => {
    const dir = tmp(),
      out = join(tmp(), "crawl.json");
    const page = imgs =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Plumbers in Leeds who answer the phone</title></head><body><h1>Plumbers</h1><a href="/about/">About us</a>${imgs.map(s => `<img src="${s}" alt="" width="10" height="10">`).join("")}</body></html>`;
    writeFileSync(join(dir, "index.html"), page(["/img/hero.jpg", "/img/logo.png", "/img/ok.webp"]));
    mkdirSync(join(dir, "about"));
    writeFileSync(join(dir, "about", "index.html"), page(["/img/hero.jpg"]));
    writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
    const logo = png(800, 400, 150 * KB);
    const site = await serve(dir, {
      files: {
        "/img/hero.jpg": { type: "image/jpeg", body: jpeg(2400, 1200, 300 * KB) },
        "/img/logo.png": { type: "image/png", body: logo },
        "/img/ok.webp": { type: "image/webp", body: webp(1000, 500, 50 * KB) },
      },
      // A server that honours the range: the full size comes from Content-Range.
      before: (req, res) => {
        if (req.url !== "/img/logo.png" || !req.headers.range) return false;
        res
          .writeHead(206, {
            "Content-Type": "image/png",
            "Content-Range": `bytes 0-65535/${logo.length}`,
            "Content-Length": 65536,
          })
          .end(logo.subarray(0, 65536));
        return true;
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
    return { origin: site.url, report: JSON.parse(readFileSync(out, "utf8")) };
  })());

test("the crawl lists the images it weighed, largest first, with pixels, format, pages and a rough saving", async () => {
  const { origin, report } = await imageSite();
  const at = p => origin + p;
  assert.deepEqual(
    report.images.map(i => i.url),
    [at("/img/hero.jpg"), at("/img/logo.png"), at("/img/ok.webp")],
  );
  const [hero, logo, ok] = report.images;
  assert.deepEqual(
    { ...hero, pages: [...hero.pages].sort() },
    {
      url: at("/img/hero.jpg"),
      bytes: 300 * KB,
      width: 2400,
      height: 1200,
      format: "jpeg",
      pages: [at("/"), at("/about/")],
      estSaving: estSaving({ bytes: 300 * KB, width: 2400, format: "jpeg" }),
    },
  );
  assert.equal(hero.estSaving, 204800, "resized to 1,600 px (4/9 of the pixels), then a quarter off");
  assert.deepEqual(
    [logo.bytes, logo.width, logo.height, logo.format, logo.estSaving],
    [150 * KB, 800, 400, "png", 39936],
    "the size from Content-Range",
  );
  assert.deepEqual([ok.format, ok.estSaving], ["webp", 0]);
  assert.ok(!report.findings.some(f => /images?-saving|images\b/.test(f.check)), "information only, no new finding");
});

test("the crawl weighs each image once, before the Googlebot test, and only on the crawled site", async () => {
  const dir = tmp(),
    awayDir = tmp(),
    out = join(tmp(), "crawl.json"),
    hits = [];
  const page = (title, imgs, extra = "") =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${extra}${imgs.map(s => `<img src="${s}" alt="" width="10" height="10">`).join("")}</body></html>`;
  mkdirSync(join(awayDir, "elsewhere"));
  writeFileSync(join(awayDir, "elsewhere", "index.html"), page("A page on another host entirely", ["/img/far.jpg"]));
  writeFileSync(
    join(dir, "index.html"),
    page("Plumbers in Leeds who answer the phone", ["/img/hero.jpg"], `<a href="/away/">Away</a>`),
  );
  const log = who => req => {
    hits.push(`${who(req)} ${req.method} ${req.url}`);
    return false;
  };
  const away = await serve(awayDir, {
    files: { "/img/far.jpg": { type: "image/jpeg", body: jpeg(2000, 1000, 300 * KB) } },
    before: log(() => "away"),
  });
  const site = await serve(dir, {
    files: { "/img/hero.jpg": { type: "image/jpeg", body: jpeg(2400, 1200, 300 * KB) } },
    before: (req, res) => {
      log(r => (/Googlebot/.test(r.headers["user-agent"]) ? "googlebot" : "site"))(req);
      if (req.url !== "/away/") return false;
      res.writeHead(301, { Location: away.url + "/elsewhere/" }).end(); // an internal link that lands on another host
      return true;
    },
  });
  try {
    await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, "--out", out]);
  } finally {
    await site.close();
    await away.close();
  }
  const report = JSON.parse(readFileSync(out, "utf8"));
  // The other host is a second local server. The crawled site is local too, so the local machine is in scope.
  assert.ok(hits.includes("away GET /elsewhere/"), "the other host's page was part of the crawl");
  assert.deepEqual(
    report.images.map(i => [i.url, i.bytes, i.width]),
    [[site.url + "/img/hero.jpg", 300 * KB, 2400]],
  );
  assert.deepEqual(
    hits.filter(h => h.startsWith("away") && h.includes("/img/")),
    [],
    "no image is asked of the other host",
  );
  assert.deepEqual(
    hits.filter(h => h.includes("/img/hero.jpg")),
    ["site GET /img/hero.jpg"],
    "one request per image",
  );
  const bot = hits.findIndex(h => h.startsWith("googlebot"));
  assert.ok(bot > 0, "the Googlebot test ran");
  assert.deepEqual(
    hits.slice(bot).filter(h => h.includes("/img/")),
    [],
    "no image request after it",
  );
});

const render = async data => {
  const dir = tmp();
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "a.html")]);
  return { html: readFileSync(join(dir, "a.html"), "utf8"), md: readFileSync(join(dir, "a.md"), "utf8") };
};

test("the images table is ranked by saving, escaped and not scored", async () => {
  const { origin, report } = await imageSite(),
    evil = "<img src=x onerror=alert(1)>|";
  const filler = Array.from({ length: 16 }, (_, i) => ({
    url: `${origin}/img/f${i}.jpg`,
    bytes: 120 * KB,
    width: 600,
    height: 400,
    format: "jpeg",
    pages: [],
    estSaving: 1000 + i,
  }));
  const images = [
    ...report.images,
    { url: evil, bytes: 200 * KB, width: 100, height: 100, format: evil, pages: [], estSaving: 50000 },
    ...filler,
  ];
  const withInfo = await render({ ...report, images }),
    without = await render({ ...report, images: undefined });
  const panels = withInfo.html.match(/\n {4}<details class="how images">[\s\S]*?<\/details>/g) || [];
  assert.equal(panels.length, 1, "one collapsed Images panel");
  const tabOf = (h, id) =>
    h.slice(h.indexOf(`id="p-${id}"`), h.indexOf('<section class="tp"', h.indexOf(`id="p-${id}"`)));
  assert.ok(tabOf(withInfo.html, "speed").includes(panels[0]), "on the Speed tab");
  for (const t of ["overview", "findings", "limits"])
    assert.equal(
      tabOf(withInfo.html, t),
      tabOf(without.html, t),
      `the panel is the only change: the score and areas are the same (${t})`,
    );
  const p = panels[0];
  assert.match(p, /<summary>Images by possible saving<\/summary>/);
  assert.equal((p.match(/<tr>/g) || []).length - 1, 15, "the top 15 rows under the header");
  const hero = p.indexOf("/img/hero.jpg"),
    bad = p.indexOf("&lt;img src=x"),
    logo = p.indexOf("/img/logo.png");
  assert.ok(hero > 0 && hero < bad && bad < logo, "largest saving first");
  assert.ok(!p.includes("/img/ok.webp"), "nothing to save, not listed");
  assert.ok(!withInfo.html.includes("<img src=x"), "crawled text is escaped");
  assert.match(p, /rough/i);
  assert.match(p, /never changes? the score/);

  const sections = withInfo.md.match(/### Images by possible saving\n[\s\S]*?\n\n(?=#{2,3} )/g) || [];
  assert.equal(sections.length, 1);
  assert.equal(
    withInfo.md.replace(sections[0], "").replace(/## Speed\n\n.*\n\n(?=## )/, ""),
    without.md,
    "the section, under its Speed heading, is the only change",
  );
  const rows = sections[0].split("\n").filter(l => /^\| `/.test(l));
  assert.equal(rows.length, 15);
  for (const row of rows)
    assert.equal(row.replace(/\\\|/g, "").split("|").length - 1, 5, `a | in the text can't break the table: ${row}`);
  const evilRow = rows.find(r => r.includes("onerror"));
  assert.ok(
    evilRow.includes("`<img src=x onerror=alert(1)>\\|`") && evilRow.includes("\\<img src=x onerror=alert(1)\\>\\|"),
    `code or escaped, never raw HTML: ${evilRow}`,
  );
});

// A stand-in for sharp in the add-on folder under home: each output file holds the steps it was made with.
function fakeSharp(home) {
  const dir = join(home, ".seo-supervisor", "tools", "node_modules", "sharp");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "sharp", main: "index.cjs" }));
  writeFileSync(
    join(dir, "index.cjs"),
    [
      'const fs = require("node:fs");',
      "module.exports = input => {",
      "  const steps = [], p = {};",
      '  for (const k of ["autoOrient", "webp", "avif"]) p[k] = () => (steps.push(k), p);',
      '  p.resize = o => (steps.push(`resize ${o.width}${o.withoutEnlargement ? " withoutEnlargement" : ""}`), p);',
      "  p.toFile = async out => {",
      '    if (/bad\\.jpg$/.test(input)) { fs.writeFileSync(out, "half"); throw new Error("Input image exceeds pixel limit"); }',
      '    const body = steps.join(",") + " of " + input; fs.writeFileSync(out, body); return { size: body.length };',
      "  };",
      "  return p;",
      "};",
      "",
    ].join("\n"),
  );
}
const env = home => ({ ...process.env, HOME: home, USERPROFILE: home });
const ORIGINAL = Buffer.alloc(5000, 7);
// A project with two images to convert, plus the cases that must be left alone.
function project() {
  const dir = tmp(),
    root = join(dir, "public"),
    crawl = join(dir, "seo-crawl.json"),
    u = p => "https://site.example" + p;
  mkdirSync(join(root, "img"), { recursive: true });
  for (const f of ["hero.jpg", "logo.png", "small.jpg", "ok.webp"]) writeFileSync(join(root, "img", f), ORIGINAL);
  writeFileSync(join(dir, "secret.jpg"), ORIGINAL);
  const img = (p, bytes, width, format) => ({
    url: u(p),
    bytes,
    width,
    height: 100,
    format,
    pages: [u("/"), u("/about/")],
    estSaving: estSaving({ bytes, width, format }),
  });
  writeFileSync(
    crawl,
    JSON.stringify({
      tool: "seo-supervisor-crawler",
      images: [
        img("/img/hero.jpg?v=3", 400 * KB, 2400, "jpeg"),
        img("/img/logo.png", 150 * KB, 800, "png"),
        img("/img/ok.webp", 300 * KB, 800, "webp"),
        img("/img/small.jpg", 20 * KB, 300, "jpeg"),
        img("/img/missing.jpg", 300 * KB, 800, "jpeg"),
        img("/..%2Fsecret.jpg", 300 * KB, 800, "jpeg"),
      ],
    }),
  );
  const files = () => readdirSync(dir, { recursive: true }).map(String).sort();
  return { dir, root, crawl, files };
}

test("images.mjs is a dry run without --yes and never touches originals", async () => {
  const p = project(),
    before = p.files(),
    home = tmp();
  const dry = await node([IMAGES, "--crawl", p.crawl, "--root", p.root], { env: env(home), cwd: p.dir });
  assert.match(dry.stdout, /hero\.jpg/);
  assert.match(dry.stdout, /logo\.png/);
  assert.doesNotMatch(dry.stdout, /small\.jpg|ok\.webp → /, "light and modern images aren't converted");
  assert.match(dry.stdout, /about 267 KB smaller/, "hero: resized to 1,600 px, then WebP (rough)");
  assert.match(dry.stdout, /\/img\/missing\.jpg/, "a file not under --root is named");
  assert.doesNotMatch(dry.stdout, /secret\.jpg →/, "a path that leaves --root is refused");
  assert.match(dry.stdout, /[Dd]ry run/);
  assert.match(dry.stdout, /--with-image-tools/, "the add-on isn't installed: it says how to add it");
  assert.match(dry.stdout, /<picture>/, "what to change in the markup");
  assert.deepEqual(p.files(), before, "nothing written");

  const yesNoAddOn = await node([IMAGES, "--crawl", p.crawl, "--root", p.root, "--yes"], {
    env: env(home),
    cwd: p.dir,
  });
  assert.match(yesNoAddOn.stdout, /npx seo-supervisor --with-image-tools/);
  assert.deepEqual(p.files(), before, "without the add-on nothing is written, and it exits 0");
  const moved = join(tmp(), "settings"),
    there = await node([IMAGES, "--crawl", p.crawl, "--root", p.root], {
      env: { ...env(home), SEO_SUPERVISOR_HOME: moved },
      cwd: p.dir,
    });
  assert.ok(
    there.stdout.includes(join(moved, "tools")),
    "the add-on's folder is named as it really is, with SEO_SUPERVISOR_HOME",
  );

  fakeSharp(home);
  await node([IMAGES, "--crawl", p.crawl, "--root", p.root, "--avif"], { env: env(home), cwd: p.dir });
  assert.deepEqual(p.files(), before, "with the add-on, still nothing without --yes");
  for (const f of ["hero.jpg", "logo.png"]) assert.deepEqual(readFileSync(join(p.root, "img", f)), ORIGINAL);

  await assert.rejects(
    node([IMAGES, "--crawl", p.crawl]),
    e => e.code === 2 && /--root/.test(e.stderr),
    "--root is required",
  );
});

test("with a stand-in converter, files are written next to the originals", async () => {
  const p = project(),
    home = tmp();
  fakeSharp(home);
  const r = await node([IMAGES, "--crawl", p.crawl, "--root", p.root, "--avif", "--yes"], {
    env: env(home),
    cwd: p.dir,
  });
  const made = f => readFileSync(join(p.root, "img", f), "utf8");
  assert.equal(
    made("hero.webp"),
    `autoOrient,resize 1600 withoutEnlargement,webp of ${join(p.root, "img", "hero.jpg")}`,
  );
  assert.match(made("hero.avif"), /,avif of /);
  assert.match(made("logo.webp"), /webp of .*logo\.png$/);
  for (const f of ["hero.jpg", "logo.png", "ok.webp", "small.jpg"])
    assert.deepEqual(readFileSync(join(p.root, "img", f)), ORIGINAL, `${f} untouched`);
  assert.ok(!existsSync(join(p.root, "img", "small.webp")) && !existsSync(join(p.dir, "secret.webp")));
  assert.match(r.stdout, /\/img\/hero\.webp/, "the new src");
  assert.match(r.stdout, /<picture>/);

  writeFileSync(join(p.root, "img", "logo.webp"), "mine");
  const again = await node([IMAGES, "--crawl", p.crawl, "--root", p.root, "--yes", "--max-width", "800"], {
    env: env(home),
    cwd: p.dir,
  });
  assert.equal(made("logo.webp"), "mine", "an existing file is never overwritten");
  assert.match(again.stdout, /logo\.webp.*left alone/);

  const out = join(p.dir, "converted");
  await node([IMAGES, "--crawl", p.crawl, "--root", p.root, "--out-dir", out, "--yes", "--max-width", "800"], {
    env: env(home),
    cwd: p.dir,
  });
  assert.match(
    readFileSync(join(out, "img", "hero.webp"), "utf8"),
    /resize 800 /,
    "--out-dir keeps the folders, --max-width sets the width",
  );
});

test("an image that won't convert is named and left alone, the rest still convert; a script URL and a repeat aren't listed", async () => {
  const dir = tmp(),
    root = join(dir, "public"),
    crawl = join(dir, "seo-crawl.json"),
    home = tmp(),
    u = p => "https://site.example" + p;
  mkdirSync(join(root, "img"), { recursive: true });
  for (const f of ["img/bad.jpg", "img/z.jpg", "timthumb.php"]) writeFileSync(join(root, f), ORIGINAL);
  const img = (p, bytes) => ({ url: u(p), bytes, width: 800, height: 100, format: "jpeg", pages: [], estSaving: 0 });
  writeFileSync(
    crawl,
    JSON.stringify({
      images: [
        img("/img/bad.jpg", 500 * KB),
        img("/img/z.jpg", 300 * KB),
        img("/img/%7a.jpg", 300 * KB),
        img("/timthumb.php?src=a.jpg", 400 * KB),
        img("/timthumb.php?src=b.jpg", 400 * KB),
      ],
    }),
  );
  fakeSharp(home);
  const dry = await node([IMAGES, "--crawl", crawl, "--root", root], { env: env(home), cwd: dir });
  assert.match(dry.stdout, /2 image\(s\) to convert/, "bad.jpg and z.jpg, once each");
  assert.equal(dry.stdout.split("\n").filter(l => /z\.jpg \(/.test(l)).length, 1, "the same file isn't listed twice");
  assert.doesNotMatch(dry.stdout, /timthumb\.php \(/, "a script that makes images isn't an image file");
  assert.match(dry.stdout, /timthumb\.php\?src=a\.jpg/, "it says what was skipped");

  const r = await node([IMAGES, "--crawl", crawl, "--root", root, "--yes"], { env: env(home), cwd: dir }).then(
    () => null,
    e => e,
  );
  assert.ok(r, "exits non-zero when one failed");
  assert.equal(r.code, 1);
  assert.match(r.stdout, /couldn't convert public\/img\/bad\.jpg \(Input image exceeds pixel limit\), left alone/);
  assert.doesNotMatch(r.stderr, /at main|Error:/, "no stack trace");
  assert.match(readFileSync(join(root, "img", "z.webp"), "utf8"), /webp of .*z\.jpg$/, "the next image still converts");
  assert.ok(!existsSync(join(root, "img", "bad.webp")), "a half-written output is removed");
  assert.ok(!existsSync(join(root, "timthumb.webp")));
});

test("--max-width needs a real width: not missing, not text, not under 320", async () => {
  const p = project();
  for (const extra of [["--max-width"], ["--max-width", "--yes"], ["--max-width", "abc"], ["--max-width", "100"]]) {
    await assert.rejects(
      node([IMAGES, "--crawl", p.crawl, "--root", p.root, ...extra], { cwd: p.dir }),
      e => e.code === 2 && /--max-width/.test(e.stderr) && !/at main/.test(e.stderr),
      extra.join(" "),
    );
  }
});

test("a folder linked from outside --root is refused unless --follow-links", async t => {
  const dir = tmp(),
    root = join(dir, "public"),
    away = join(dir, "elsewhere"),
    crawl = join(dir, "seo-crawl.json"),
    home = tmp();
  mkdirSync(root);
  mkdirSync(away);
  writeFileSync(join(away, "p.jpg"), ORIGINAL);
  try {
    symlinkSync(away, join(root, "uploads"), "junction");
  } catch (e) {
    return t.skip(`can't make a link here (${e.code})`);
  }
  writeFileSync(
    crawl,
    JSON.stringify({
      images: [
        {
          url: "https://site.example/uploads/p.jpg",
          bytes: 300 * KB,
          width: 800,
          height: 100,
          format: "jpeg",
          pages: [],
        },
      ],
    }),
  );
  fakeSharp(home);
  const refused = await node([IMAGES, "--crawl", crawl, "--root", root, "--yes"], { env: env(home), cwd: dir });
  assert.ok(!existsSync(join(away, "p.webp")), "nothing written outside --root");
  assert.match(refused.stdout, /uploads\/p\.jpg/);
  assert.match(refused.stdout, /--follow-links/, "it says how to allow it");

  await node([IMAGES, "--crawl", crawl, "--root", root, "--yes", "--follow-links"], { env: env(home), cwd: dir });
  assert.match(readFileSync(join(away, "p.webp"), "utf8"), /webp of /, "--follow-links allows it");

  // The same under --out-dir: a real file, and an output folder that links outside --out-dir.
  const root2 = join(dir, "public2"),
    out = join(dir, "out"),
    outAway = join(dir, "out-elsewhere");
  mkdirSync(join(root2, "uploads"), { recursive: true });
  mkdirSync(out);
  mkdirSync(outAway);
  writeFileSync(join(root2, "uploads", "p.jpg"), ORIGINAL);
  symlinkSync(outAway, join(out, "uploads"), "junction");
  const outRefused = await node([IMAGES, "--crawl", crawl, "--root", root2, "--out-dir", out, "--yes"], {
    env: env(home),
    cwd: dir,
  });
  assert.ok(!existsSync(join(outAway, "p.webp")), "an --out-dir folder that links outside it is refused");
  assert.match(outRefused.stdout, /--follow-links/);
  await node([IMAGES, "--crawl", crawl, "--root", root2, "--out-dir", out, "--yes", "--follow-links"], {
    env: env(home),
    cwd: dir,
  });
  assert.ok(existsSync(join(outAway, "p.webp")));
});
