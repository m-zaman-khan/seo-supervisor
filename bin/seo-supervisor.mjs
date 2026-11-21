#!/usr/bin/env node
// Installs the skill into the chosen coding agents (bin/agents.mjs), with its /seo-* commands for Claude Code.
// No dependencies.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { AGENTS, agentByKey, allTargets, detectAgents, targetsFor } from "./agents.mjs";
import { multiSelect, select } from "./prompt.mjs";
import { browserFile, toolsDir } from "../skills/seo-supervisor/scripts/lib/settings-dir.mjs";

const NAME = "seo-supervisor";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

// Subcommands that run a skill script directly, with no agent.
const SCRIPT = { doctor: "doctor.mjs", dashboard: "dashboard.mjs" }[process.argv[2]];
if (SCRIPT)
  process.exit(
    spawnSync(process.execPath, [join(ROOT, "skills", NAME, "scripts", SCRIPT), ...process.argv.slice(3)], {
      stdio: "inherit",
    }).status ?? 1,
  );

const HELP = `SEO Supervisor ${version}

Usage: npx seo-supervisor [options]

With no options it asks where to install and for which agents.

  --agent <keys>    Comma-separated agents, or "all". No questions about agents.
  --scope <scope>   "user" (you, in every project) or "project" (this folder, to commit for your team)
  --project         Same as --scope project
  --yes, -y         No questions: the agents it finds (Claude Code if none), user scope
  --uninstall       Remove what this installer added, in the chosen scope (user by default)
  --force           Replace a skill folder or command file that isn't SEO Supervisor's
  --with-lighthouse Also install the optional Lighthouse add-on (about 170 MB, in ~/.seo-supervisor/tools, not your project)
  --no-lighthouse   Don't ask about Lighthouse
  --with-image-tools Also install the optional image add-on, sharp (about 20 MB, in ~/.seo-supervisor/tools), which scripts/images.mjs uses to convert images to WebP and AVIF
  --with-browser    Also install Chrome for Testing (in ~/.seo-supervisor/tools), for containers and CI with no Chrome or Edge
  --zip [file]      Only write the skill as a zip (seo-supervisor.zip), to upload to claude.ai or the Claude desktop app
  --version         Print the version

Commands that run here, with no agent:
  npx seo-supervisor doctor                  Check Node, Chrome or Edge, the add-ons and the connections (changes nothing)
  npx seo-supervisor dashboard [folders...]  Every audit's score, lowest first; --out dashboard.html writes a page

The settings folder (~/.seo-supervisor) moves with SEO_SUPERVISOR_HOME. SEO_SUPERVISOR_CLIENT=<name> keeps a
client's logins and keys apart, in clients/<name> inside it.

Agent keys: ${AGENTS.map(a => a.key).join(", ")}
`;

// ---- arguments ----
const opts = {};
const argv = process.argv.slice(2);
for (let n = 0; n < argv.length; n++) {
  const a = argv[n];
  if (a === "--agent" || a === "--scope") {
    opts[a.slice(2)] = argv[++n];
    continue;
  }
  if (a === "--with-lighthouse" || a === "--no-lighthouse") {
    opts.lighthouse = a === "--with-lighthouse";
    continue;
  }
  if (a === "--zip") {
    opts.zip = argv[n + 1] && !argv[n + 1].startsWith("-") ? argv[++n] : `${NAME}.zip`;
    continue;
  }
  const flag = {
    "--project": "project",
    "--agents": "agents",
    "--uninstall": "uninstall",
    "--force": "force",
    "--with-image-tools": "imageTools",
    "--with-browser": "browser",
    "--yes": "yes",
    "-y": "yes",
    "--help": "help",
    "-h": "help",
    "--version": "version",
    "-v": "version",
  }[a];
  if (!flag) {
    console.error(`Unknown option: ${a}\n\n${HELP}`);
    process.exit(2);
  }
  opts[flag] = true;
}
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
if (opts.version) {
  console.log(version);
  process.exit(0);
}

const c = { home: homedir(), cwd: process.cwd(), env: process.env };
const show = p => (p.startsWith(c.home) ? "~" + p.slice(c.home.length) : p).replace(/\\/g, "/");
const TOOLS = toolsDir(c.env, c.home); // optional add-ons, outside the package and the project
let scope = opts.scope || (opts.project ? "project" : null);
if (scope && !["user", "project"].includes(scope)) {
  console.error(`Unknown scope: ${scope}. Use "user" or "project".`);
  process.exit(2);
}

let keys = null;
if (opts.agent) {
  keys =
    opts.agent === "all"
      ? AGENTS.map(a => a.key)
      : opts.agent
          .split(",")
          .map(s => s.trim())
          .filter(Boolean);
  const bad = keys.find(k => !agentByKey(k));
  if (bad) {
    console.error(`Unknown agent: ${bad}\nAgent keys: ${AGENTS.map(a => a.key).join(", ")}`);
    process.exit(2);
  }
}

// ---- what this package owns ----
const SRC_SKILL = join(ROOT, "skills", NAME);
const SRC_COMMANDS = join(ROOT, "commands");
const commandFiles = readdirSync(SRC_COMMANDS).filter(f => f.endsWith(".md"));
const ownsSkill = dir => {
  try {
    return /^name:\s*seo-supervisor\s*$/m.test(readFileSync(join(dir, "SKILL.md"), "utf8"));
  } catch {
    return false;
  }
};
const ownsCommand = file => {
  try {
    return readFileSync(file, "utf8").includes(NAME);
  } catch {
    return false;
  }
};

// ---- --zip: the skill for claude.ai and the Claude desktop app, which take an uploaded zip ----
// The skill folder sits at the zip's root, named like the skill.
// https://support.claude.com/en/articles/12512198
// https://support.claude.com/en/articles/12512180
// Deflated entries with UTF-8 names, per PKWARE APPNOTE 4.3.
const CRC = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = b => {
  let x = ~0;
  for (const v of b) x = CRC[(x ^ v) & 255] ^ (x >>> 8);
  return ~x >>> 0;
};
function zipFolder(src, root, out) {
  const files = readdirSync(src, { recursive: true })
    .filter(f => statSync(join(src, f)).isFile())
    .map(f => f.split(sep).join("/"))
    .sort();
  const d = new Date(),
    time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [],
    dir = [];
  let at = 0;
  for (const f of files) {
    const data = readFileSync(join(src, f)),
      packed = deflateRawSync(data),
      name = Buffer.from(`${root}/${f}`),
      crc = crc32(data);
    // version needed 2.0, flags: UTF-8 names, method 8 (deflate), time, date, CRC-32, sizes, name length
    const common = [
      [20, 2],
      [0x0800, 2],
      [8, 2],
      [time, 2],
      [date, 2],
      [crc, 4],
      [packed.length, 4],
      [data.length, 4],
      [name.length, 2],
    ];
    const head = (sig, extra) => {
      const b = Buffer.alloc(sig === 0x04034b50 ? 30 : 46);
      let o = 0;
      const put = ([v, n]) => {
        n === 2 ? b.writeUInt16LE(v, o) : b.writeUInt32LE(v, o);
        o += n;
      };
      put([sig, 4]);
      extra.forEach(put);
      return b;
    };
    parts.push(head(0x04034b50, [...common, [0, 2]]), name, packed);
    dir.push(head(0x02014b50, [[20, 2], ...common, [0, 2], [0, 2], [0, 2], [0, 2], [0, 4], [at, 4]]), name);
    at += 30 + name.length + packed.length;
  }
  const cd = Buffer.concat(dir),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(at, 16);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.concat([...parts, cd, end]));
  return files.length;
}
if (opts.zip) {
  const out = resolve(opts.zip),
    n = zipFolder(SRC_SKILL, NAME, out);
  console.log(`Wrote ${show(out)}: the ${NAME} skill folder, ${n} files.

To use it in Claude on the web (claude.ai) or in the Claude desktop app:
  1. Turn on code execution: Settings → Capabilities → "Code execution and file creation" (or "Create and edit files").
     On a Team or Enterprise plan, an owner may have to allow skills first.
  2. Open Customize → Skills, click +, then Create skill → Upload a skill, and choose ${show(out)}.
  3. Ask: "audit the SEO of https://www.example.com".

Skills uploaded there don't sync with Claude Code or other agents (install those with npx seo-supervisor), and they
don't update themselves: upload a new zip after an update. There, the crawler reaches your site only if your code
execution settings allow network access, it can't reach a site running on your own computer, and the checks that
need Chrome or Edge may not run.`);
  process.exit(0);
}

// ---- uninstall ----
if (opts.uninstall) {
  scope ||= "user";
  let removed = 0;
  for (const t of allTargets(scope, c)) {
    const dir = join(t.skills, NAME);
    if (ownsSkill(dir)) {
      rmSync(dir, { recursive: true, force: true });
      console.log(`removed  ${show(dir)}`);
      removed++;
    }
    for (const f of t.commands ? commandFiles : []) {
      const file = join(t.commands, f);
      if (ownsCommand(file)) {
        rmSync(file);
        console.log(`removed  ${show(file)}`);
        removed++;
      }
    }
  }
  console.log(removed ? "\nSEO Supervisor uninstalled." : `\nNothing to remove in the ${scope} scope.`);
  if (existsSync(TOOLS))
    console.log(
      `The optional add-ons (Lighthouse, about 170 MB; sharp for images, about 20 MB; Chrome for Testing) stay in ${show(TOOLS)}, shared by every install. To remove them too, delete that folder: ${TOOLS}`,
    );
  process.exit(0);
}

// ---- questions (only in a real terminal, and only for what flags didn't settle) ----
const interactive = !opts.yes && process.stdin.isTTY && process.stdout.isTTY && !process.env.CI;
const detected = detectAgents(c);
const fallback = detected.length ? detected : ["claude-code"];
try {
  if (interactive) console.log(`\nSEO Supervisor ${version}\n`);
  if (!scope) {
    scope = interactive
      ? await select({
          message: "Install for",
          items: [
            { value: "user", label: "Me, in every project", hint: "each agent's folder in your home directory" },
            { value: "project", label: "This project only", hint: `${show(c.cwd)}, to commit for your team` },
          ],
        })
      : "user";
  }
  if (!keys) {
    if (interactive) {
      const order = [...AGENTS].sort((a, b) => Number(detected.includes(b.key)) - Number(detected.includes(a.key)));
      const where = a => show(targetsFor([a.key], scope, c)[0].skills);
      keys = await multiSelect({
        message: "Which agents?",
        items: order.map(a => ({
          value: a.key,
          label: a.name.padEnd(36),
          hint: `${detected.includes(a.key) ? "found · " : ""}${where(a)}`,
        })),
        selected: opts.agents ? [...fallback, "other"] : fallback,
      });
    } else keys = opts.agents ? [...fallback, "other"] : fallback;
  } else if (opts.agents && !keys.includes("other")) keys.push("other");
  if (opts.lighthouse === undefined && interactive && !existsSync(join(TOOLS, "node_modules", "lighthouse"))) {
    opts.lighthouse = await select({
      message: `Add Lighthouse for speed and quality scores? It's optional, about 170 MB, installed in ${show(TOOLS)} (not your project).`,
      items: [
        { value: false, label: "No" },
        { value: true, label: "Yes, install it" },
      ],
    });
  }
} catch (e) {
  if (e.code === "CANCELLED") {
    console.log("\nCancelled. Nothing was installed.");
    process.exit(130);
  }
  throw e;
}

// ---- install ----
let problems = 0;
const names = [];
if (interactive) console.log("");
for (const t of targetsFor(keys, scope, c)) {
  const dir = join(t.skills, NAME);
  if (existsSync(dir) && !ownsSkill(dir) && !opts.force) {
    console.error(`skipped  ${show(dir)}: it exists and isn't SEO Supervisor (use --force to replace it)`);
    problems++;
  } else {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(t.skills, { recursive: true });
    cpSync(SRC_SKILL, dir, { recursive: true });
    console.log(`skill    ${show(dir)}  (${t.agents.join(", ")})`);
    names.push(...t.agents);
  }
  if (!t.commands) continue;
  mkdirSync(t.commands, { recursive: true });
  const added = [];
  for (const f of commandFiles) {
    const file = join(t.commands, f);
    if (existsSync(file) && !ownsCommand(file) && !opts.force) {
      console.error(
        `skipped  ${show(file)}: a different /${f.slice(0, -3)} command exists (use --force to replace it)`,
      );
      problems++;
      continue;
    }
    cpSync(join(SRC_COMMANDS, f), file);
    added.push("/" + f.slice(0, -3));
  }
  if (added.length) console.log(`commands ${added.join(" ")}  (${show(t.commands)})`);
}

// ---- optional add-ons in TOOLS: a failure never fails the install, since the skill works without them ----
// error is null on success, else the reason. capture also returns npm's stdout, still printing it.
function npm(args, capture = false) {
  const bin = c.env.SEO_SUPERVISOR_NPM || "npm",
    o = { stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit", encoding: "utf8" };
  // A .js bin runs with this Node. On Windows npm is npm.cmd, which only starts through a shell. Only parts with spaces
  // are quoted: cmd gives a quoted batch name found on PATH the wrong %~dp0, and npm.cmd then can't find npm.
  const r = /\.[cm]?js$/i.test(bin)
    ? spawnSync(process.execPath, [bin, ...args], o)
    : process.platform === "win32"
      ? spawnSync([bin, ...args].map(a => (/\s/.test(a) ? `"${a}"` : a)).join(" "), { ...o, shell: true })
      : spawnSync(bin, args, o);
  if (capture && r.stdout) process.stdout.write(r.stdout);
  return {
    error: r.status === 0 ? null : r.error ? r.error.message : `npm exited with code ${r.status}`,
    stdout: r.stdout || "",
  };
}
// Returns null on success, else the reason.
const npmInstall = spec => npm(["install", "--prefix", TOOLS, spec, "--no-audit", "--no-fund"]).error;
if (opts.lighthouse) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19))
    console.error(
      `\nLighthouse wasn't installed: Lighthouse 13 needs Node 22.19 or later, this is ${process.versions.node}. The skill works without it.`,
    );
  else {
    console.log(`\nInstalling Lighthouse into ${show(TOOLS)} (about 170 MB, usually a minute or two)...`);
    const err = npmInstall("lighthouse@13");
    if (!err) console.log(`lighthouse ${show(TOOLS)}  (the crawler runs it with --outside --lighthouse)`);
    else
      console.error(
        `Lighthouse wasn't installed (${err}). The skill works without it; try again later with npx seo-supervisor --with-lighthouse, or npm i -g lighthouse.`,
      );
  }
}
// sharp is never prompted for: fix mode offers it when an audit finds heavy images. Each 0.x minor of sharp is a
// breaking release, so 0.35 is pinned. It's about 1 MB plus an 18–20 MB prebuilt libvips.
if (opts.imageTools) {
  console.log(`\nInstalling sharp, the image add-on, into ${show(TOOLS)} (about 20 MB)...`);
  const err = npmInstall("sharp@0.35");
  if (!err) console.log(`sharp    ${show(TOOLS)}  (scripts/images.mjs converts images with it, only after your yes)`);
  else
    console.error(
      `sharp wasn't installed (${err}). The skill works without it; try again later with npx seo-supervisor --with-image-tools.`,
    );
}
// Chrome for Testing for containers and CI without Chrome or Edge, from the Chrome team's @puppeteer/browsers run with
// npm exec, never as a dependency. It prints "chrome@<build> <executable>"; settings-dir.mjs reads the saved path.
// --install-deps adds Chrome's system libraries; it needs root and works on Debian and Ubuntu.
// https://pptr.dev/browsers-api
if (opts.browser) {
  console.log(`\nInstalling Chrome for Testing into ${show(join(TOOLS, "browsers"))}...`);
  const deps = process.platform === "linux" && process.getuid?.() === 0 ? ["--install-deps"] : [];
  const r = npm(
    [
      "exec",
      "--yes",
      "--",
      "@puppeteer/browsers@3",
      "install",
      "chrome@stable",
      "--path",
      join(TOOLS, "browsers"),
      ...deps,
    ],
    true,
  );
  const exe = r.stdout.match(/^chrome@\S+ (.+?)\s*$/m)?.[1];
  if (!r.error && exe) {
    mkdirSync(TOOLS, { recursive: true });
    writeFileSync(browserFile(c.env, c.home), exe + "\n");
    console.log(`chrome   ${exe}  (Chrome for Testing; the scripts also use it when CHROME_PATH points to it)`);
  } else
    console.error(
      `The browser wasn't installed (${r.error || "npm didn't say where it went"}). The skill works without it: the checks that need Chrome or Edge are listed under Limits. ${deps.length || process.platform !== "linux" ? "" : "On Linux, Chrome also needs system libraries: run this as root on Debian or Ubuntu, or install them with your package manager. "}Try again later with npx seo-supervisor --with-browser.`,
    );
}

const usesClaude = keys.includes("claude-code");
console.log(`\nSEO Supervisor ${version} installed for ${names.join(", ") || "nothing"}.`);
console.log(
  usesClaude
    ? `In Claude Code run /seo-audit (or /seo-setup for a site with no SEO yet).${names.length > 1 ? ' In the other agents, ask: "audit the SEO of this site".' : ""}`
    : `Open your agent and ask: "audit the SEO of this site".`,
);
process.exit(problems ? 1 : 0);
