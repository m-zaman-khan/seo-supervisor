import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, node, tmp } from "./helpers.mjs";

const CLI = join(SCRIPTS, "disavow.mjs");
const today = () => new Date().toLocaleDateString("en-CA");
// Writes the given files into a temp folder, runs disavow.mjs there and returns { out, stdout } (out: the file's text).
async function disavow(args, files = {}) {
  const dir = tmp(),
    out = join(dir, "disavow.txt");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const fill = a => (Object.hasOwn(files, a) ? join(dir, a) : a);
  const { stdout } = await node([
    CLI,
    "--site",
    "https://www.acme.com",
    ...args.map(fill),
    ...(args.includes("--out") ? [] : ["--out", out]),
  ]);
  return { out: readFileSync(out, "utf8"), stdout };
}
const refused = (args, files, pattern) =>
  assert.rejects(disavow(args, files), e => e.code === 2 && pattern.test(e.stderr), String(pattern));

test("writes a valid disavow file with a dated comment, and prints the upload steps", async () => {
  const { out, stdout } = await disavow(
    [
      "--domains",
      "Spam.example, domain:links.example,spam.example",
      "--urls",
      "urls.txt",
      "--reason",
      "Paid links\nfrom 2024",
    ],
    {
      "urls.txt":
        "# from the Links export\r\nhttps://blog.example/post-1\r\n\r\nhttps://blog.example/post-1\r\nhttps://bücher.example/seite\r\n",
    },
  );
  assert.equal(
    out,
    `# Added ${today()}: Paid links from 2024\ndomain:spam.example\ndomain:links.example\nhttps://blog.example/post-1\nhttps://bücher.example/seite\n`,
  );
  assert.match(stdout, /Most sites never need this/);
  assert.match(stdout, /replaces the list already in Search Console/);
  assert.match(stdout, /--existing/, "no --existing: says the old lines would be lost");
  assert.match(stdout, /https:\/\/search\.google\.com\/search-console\/disavow-links/);
  assert.match(stdout, /Domain propert/);
  assert.match(stdout, /https:\/\/www\.acme\.com\//, "names the property");
  assert.doesNotMatch(stdout, /toxic/i);
  const bare = await disavow(["--domains", "spam.example"]);
  assert.equal(bare.out, `# Added ${today()} with disavow.mjs\ndomain:spam.example\n`);
});

test("keeps every line of the existing file and adds only what's new", async () => {
  const existing = "﻿# old list\r\ndomain:old.example\r\nhttps://x.example/a\r\n\r\n# note\r\ndomain:Spam.example\r\n";
  const { out, stdout } = await disavow(
    ["--domains", "spam.example,new.example", "--urls", "u.txt", "--existing", "old.txt"],
    { "old.txt": existing, "u.txt": "https://x.example/a\nhttps://x.example/b\n" },
  );
  assert.equal(
    out,
    `# old list\ndomain:old.example\nhttps://x.example/a\n\n# note\ndomain:Spam.example\n\n# Added ${today()} with disavow.mjs\ndomain:new.example\nhttps://x.example/b\n`,
  );
  assert.match(stdout, /keeps every line/);
  assert.match(stdout, /2 already in the list/);
  await refused(["--domains", "SPAM.example", "--existing", "old.txt"], { "old.txt": existing }, /already in/);
  await refused(
    ["--domains", "a.example", "--existing", "old.txt"],
    { "old.txt": "domain:old.example\nsome words\n" },
    /old\.txt line 2/,
  );
});

test("refuses the site itself, an empty list and malformed entries", async () => {
  await Promise.all([
    ...["acme.com", "www.acme.com", "blog.acme.com", "domain:ACME.com"].map(d =>
      refused(["--domains", d], {}, /your own site/),
    ),
    refused(["--urls", "u.txt"], { "u.txt": "https://spam.example/a\nhttps://www.acme.com/page\n" }, /your own site/),
    refused([], {}, /^usage: node disavow\.mjs/),
    refused(["--domains", " , "], {}, /no domains or URLs/i),
    refused(["--urls", "u.txt"], { "u.txt": "# nothing here\n\n" }, /no domains or URLs/i),
    ...[
      "spam,example",
      "http://spam.example/page",
      "-bad.example",
      "localhost",
      "1.2.3.4",
      "spam.example/",
      "spam.example:8080",
    ].map(d => refused(["--domains", d], {}, /isn't a domain name/)),
    refused(["--urls", "u.txt"], { "u.txt": "https://spam.example/a\nnot a url\n" }, /u\.txt line 2/),
    refused(["--urls", "u.txt"], { "u.txt": "ftp://spam.example/a\n" }, /u\.txt line 1/),
    refused(["--domains", "spam.example", "--out", "x.csv"], {}, /\.txt/),
    refused(["--site", "acme", "--domains", "spam.example"], {}, /--site/),
  ]);
});

test("refuses half-written URLs, and an old list that disavows the site itself", async () => {
  await refused(["--urls", "u.txt"], { "u.txt": "http:spam.example\n" }, /isn't a web address/);
  await refused(["--urls", "u.txt"], { "u.txt": "https:/spam.example/x\n" }, /isn't a web address/);
  await refused(
    ["--domains", "new.example", "--existing", "old.txt"],
    { "old.txt": "domain:acme.com\n" },
    /old\.txt line 1 .*your own site/,
  );
  await refused(
    ["--domains", "new.example", "--existing", "old.txt"],
    { "old.txt": "# x\nhttps://blog.acme.com/a\n" },
    /old\.txt line 2 .*your own site/,
  );
});

test("enforces Google's limits: 2,048-character URLs, 100,000 lines and 2 MB", async () => {
  const long = "https://spam.example/" + "a".repeat(2048 - 21);
  assert.equal(long.length, 2048);
  assert.match((await disavow(["--urls", "u.txt"], { "u.txt": long + "\n" })).out, /a{2000}/, "2,048 is allowed");
  await refused(["--urls", "u.txt"], { "u.txt": long + "a\n" }, /2,048/);
  await refused(
    ["--domains", "new.example", "--existing", "old.txt"],
    { "old.txt": "# x\n".repeat(99998) },
    /100,000 lines/,
  );
  const ok = await disavow(["--domains", "new.example", "--existing", "old.txt"], { "old.txt": "# x\n".repeat(99997) });
  assert.equal(ok.out.split("\n").length - 1, 100000, "exactly 100,000 lines is allowed");
  await refused(
    ["--domains", "new.example", "--existing", "old.txt"],
    { "old.txt": ("#" + "x".repeat(99999) + "\n").repeat(20) },
    /2 MB/,
  );
});
