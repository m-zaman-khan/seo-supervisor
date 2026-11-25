// @ts-check
// Offline guard for the fast suite. `npm test` preloads it with --import and it adds itself to NODE_OPTIONS, so every
// node process a test starts loads it too. A TCP connection or DNS lookup to anything but loopback, or starting Chrome,
// Edge, Chromium or the system's "open a link" command, throws an error naming the host or program. The error goes to
// stderr at once and the process exits with code 99, even when the code under test catches it.
// It also turns off the crawler's fixed pauses (SEO_SUPERVISOR_NO_PAUSES; an empty value keeps them) and drops the
// developer's PageSpeed and CrUX keys.
import cp from "node:child_process";
import dns from "node:dns";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

const SELF = `--import=${import.meta.url}`;
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|::1|\[::1\]|0\.0\.0\.0|::ffff:127(\.\d{1,3}){3})$/i;
const BROWSER = /^(google[ -]chrome.*|chrome.*|chromium.*|msedge|microsoft[ -]edge.*)(\.exe)?$/i;
const refused = [];
const refuse = what => {
  const msg = `offline guard: refused ${what}. Tests must stay on this machine (test/offline.mjs).`;
  refused.push(what);
  process.stderr.write(msg + "\n");
  return Object.assign(new Error(msg), { code: "EOFFLINEGUARD" });
};
process.on("exit", () => {
  if (!refused.length) return;
  process.stderr.write(
    `offline guard: ${refused.length} outside contact(s) refused in this process: ${[...new Set(refused)].join("; ")}\n`,
  );
  if (!process.exitCode) process.exitCode = 99;
});

// ---------- the environment ----------
if (!(process.env.NODE_OPTIONS || "").includes(SELF))
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ""} ${SELF}`.trim();
// Loaded from the command line (npm test and the test files it runs), the developer's keys go. Processes a test starts
// load it through NODE_OPTIONS instead, so a key a test sets for them stays.
if (process.execArgv.some(a => /offline\.mjs/.test(a))) {
  delete process.env.PSI_API_KEY;
  delete process.env.CRUX_API_KEY;
}
process.env.SEO_SUPERVISOR_NO_PAUSES ??= "1";

// ---------- TCP: every connection, plain or TLS, goes through Socket.prototype.connect ----------
const connect = net.Socket.prototype.connect;
// connect(options | [options, cb] | path | port, host?, cb?). A name with the caller's own lookup (a test's stand-in
// DNS, or code that pins a checked address) is judged by the address that lookup gives: that's where the socket goes.
net.Socket.prototype.connect = function (...args) {
  const a = Array.isArray(args[0]) ? args[0][0] : args[0];
  const o =
    a && typeof a === "object"
      ? a
      : typeof a === "string" && !/^\d+$/.test(a)
        ? { path: a }
        : { port: a, host: typeof args[1] === "string" ? args[1] : undefined };
  if (o.path || LOOPBACK.test(String(o.host ?? "localhost"))) return connect.apply(this, args);
  if (typeof o.lookup !== "function") throw refuse(`a connection to ${o.host}:${o.port}`);
  const lookup = o.lookup,
    checked = {
      ...o,
      lookup: (host, opts, cb) =>
        lookup(host, opts, (err, addr, family) => {
          const bad = err
            ? null
            : (Array.isArray(addr) ? addr.map(x => x.address) : [addr]).find(x => !LOOPBACK.test(String(x)));
          cb(bad ? refuse(`a connection to ${host}:${o.port} (${bad})`) : err, addr, family);
        }),
    };
  if (Array.isArray(args[0])) args[0][0] = checked;
  else args[0] = checked;
  return connect.apply(this, args);
};

// ---------- DNS: lookups, resolves and reverse lookups, callback and promise forms ----------
for (const obj of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
  const promises = obj === dns.promises || obj === dns.promises.Resolver.prototype;
  for (const k of Object.getOwnPropertyNames(obj)) {
    const orig = obj[k];
    if (!/^(lookup|resolve|reverse)/.test(k) || typeof orig !== "function") continue;
    obj[k] = function (host, ...rest) {
      if (LOOPBACK.test(String(host))) return orig.call(this, host, ...rest);
      const e = refuse(`a DNS lookup of ${host}`),
        cb = rest.at(-1);
      if (typeof cb === "function") return void process.nextTick(cb, e);
      if (promises) return Promise.reject(e);
      throw e;
    };
  }
}

// ---------- child processes: no browser, and every node child loads this guard ----------
const program = (file, args = []) => {
  const name = String(file).split(/[\\/]/).pop(); // a Windows path is caught on Linux too
  if (BROWSER.test(name)) throw refuse(`to start a browser (${file})`);
  if (/^(xdg-open|open)$/i.test(name) || (/^cmd(\.exe)?$/i.test(name) && args.some(x => /^start$/i.test(String(x)))))
    throw refuse(`to open a link with ${[file, ...args].join(" ")}`);
};
const withGuard = env => {
  const k = Object.keys(env).find(x => /^NODE_OPTIONS$/i.test(x)) || "NODE_OPTIONS";
  return (env[k] || "").includes(SELF) ? env : { ...env, [k]: `${env[k] || ""} ${SELF}`.trim() };
};
// spawn, execFile, exec and fork all end in ChildProcess.prototype.spawn, with the env already as KEY=VALUE pairs.
const proto = /** @type {any} */ (cp.ChildProcess.prototype),
  spawn = proto.spawn;
proto.spawn = function (options) {
  program(options.file, options.args.slice(1));
  if (options.envPairs) {
    const i = options.envPairs.findIndex(p => /^NODE_OPTIONS=/i.test(p));
    if (i < 0) options.envPairs.push(`NODE_OPTIONS=${SELF}`);
    else if (!options.envPairs[i].includes(SELF)) options.envPairs[i] += ` ${SELF}`;
  }
  return spawn.call(this, options);
};
// The sync forms don't go through it: check them one by one. The options object is the last plain-object argument.
for (const k of ["spawnSync", "execFileSync", "execSync"]) {
  const orig = cp[k];
  cp[k] = function (file, ...rest) {
    const args = Array.isArray(rest[0]) ? rest[0] : [];
    program(k === "execSync" ? String(file).trim().split(/\s+/)[0].replace(/^"|"$/g, "") : file, args);
    const i = rest.findLastIndex(x => x && typeof x === "object" && !Array.isArray(x));
    if (i >= 0 && rest[i].env) rest[i] = { ...rest[i], env: withGuard(rest[i].env) };
    return orig.call(this, file, ...rest);
  };
}
syncBuiltinESMExports();
