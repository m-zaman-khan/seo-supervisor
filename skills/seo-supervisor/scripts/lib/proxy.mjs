// Company proxies. Node honours HTTP_PROXY / HTTPS_PROXY (minus NO_PROXY; lowercase names win) only with
// NODE_USE_ENV_PROXY=1: fetch() from Node 22.21 and 24.0, http(s).request() and --use-env-proxy from 22.21 and 24.5.
// Chrome over CDP gets the same proxy as flags.
// https://nodejs.org/api/cli.html#node_use_env_proxy1

const pick = (env, name) => env[name.toLowerCase()] || env[name];
const since = (version, v24) => {
  const [a, b] = version.split(".").map(Number);
  return a > 24 || (a === 24 && b >= v24) || (a === 22 && b >= 21);
};

// One plain line when a proxy is set but this Node won't use it for fetch(), else null.
export function proxyNote(env = process.env, { execArgv = process.execArgv, version = process.versions.node } = {}) {
  if (!pick(env, "HTTPS_PROXY") && !pick(env, "HTTP_PROXY")) return null;
  const on =
    env.NODE_USE_ENV_PROXY === "1" ||
    [...execArgv, ...(env.NODE_OPTIONS || "").split(/\s+/)].includes("--use-env-proxy");
  if (!since(version, 0))
    return `A proxy is set (HTTPS_PROXY or HTTP_PROXY), but Node ${version} can't send requests through it, so requests to other sites may fail. Node 22.21 or 24.0 and later can, when NODE_USE_ENV_PROXY=1 is set.`;
  return on
    ? null
    : `A proxy is set (HTTPS_PROXY or HTTP_PROXY), but Node uses it only when started with NODE_USE_ENV_PROXY=1${since(version, 5) ? " (or --use-env-proxy)" : ""}, so requests to other sites may fail. Set it and run this again.`;
}

// Chrome's --proxy-server (scheme=proxy pairs when http and https differ) and --proxy-bypass-list from NO_PROXY; Chrome
// bypasses localhost itself. Credentials are dropped, since other users can read a command line. A value without a
// scheme (curl's user:pass@host:port) is read as http://; one with no host gets no argument, never the raw value.
// https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md
const server = u => {
  try {
    const x = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(u) ? u : "http://" + u);
    if (x.host) return `${x.protocol}//${x.host}`;
  } catch {}
  return null;
};
export function chromeProxyArgs(env = process.env) {
  const bypass = (pick(env, "NO_PROXY") || "").replace(/\s+/g, "");
  const http = pick(env, "HTTP_PROXY") && server(pick(env, "HTTP_PROXY")),
    https = pick(env, "HTTPS_PROXY") && server(pick(env, "HTTPS_PROXY"));
  if ((!http && !https) || bypass === "*") return [];
  const to = http === https ? http : [http && `http=${http}`, https && `https=${https}`].filter(Boolean).join(";");
  return [
    `--proxy-server=${to}`,
    ...(bypass ? [`--proxy-bypass-list=${bypass.split(",").filter(Boolean).join(";")}`] : []),
  ];
}
