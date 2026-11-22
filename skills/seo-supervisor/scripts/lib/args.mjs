// @ts-check
// The scripts' one argument parser: --name value, --name=value and --name alone (true). A word not starting with --
// is the previous flag's value, else a positional in _; a value never starts with --, so "--out --yes" sets both true.
// A repeated flag keeps its last value unless it's in lists. --help or -h anywhere prints usage and exits 0 (runMain).
import { Fail } from "./cli.mjs";

export const isHelp = a => a === "--help" || a === "-h";

/**
 * @param {string[]} argv the words after the script's name
 * @param {{ flags?: string[], booleans?: string[], aliases?: Record<string, string>, lists?: string[], positionals?: number, usage?: string }} [o]
 *   flags: the flags that take a value; when given, any flag not listed here, in booleans, lists or aliases stops the
 *   script, so a misspelt one isn't silently ignored. booleans: flags that never take a value (the next word stays a
 *   positional). aliases: another spelling → the flag's own name. lists: flags that may repeat, collected in an array.
 *   positionals: how many positional words the script takes (any number unless given); one more stops the script.
 *   usage: what --help prints.
 * @returns {{ _: string[], [flag: string]: any }}
 */
export function parseArgs(
  argv,
  {
    flags,
    booleans = [],
    aliases = {},
    lists = [],
    positionals = Infinity,
    usage = "See the comment at the top of the script for its options.",
  } = {},
) {
  if (argv.some(isHelp)) throw new Fail(usage, 0);
  const out = /** @type {{ _: string[], [flag: string]: any }} */ ({ _: [] });
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      if (out._.length >= positionals)
        throw new Fail(
          `unexpected "${a}": options start with --, like --${a.replace(/^-+/, "")}${positionals ? "" : "; this script takes no other words"}.`,
        );
      out._.push(a);
      continue;
    }
    const eq = a.indexOf("="),
      name = a.slice(2, eq < 0 ? undefined : eq),
      k = Object.hasOwn(aliases, name) ? aliases[name] : name;
    let v = /** @type {string | true | undefined} */ (eq < 0 ? undefined : a.slice(eq + 1));
    if (flags && ![flags, booleans, lists].some(l => l.includes(k)))
      throw new Fail(`unknown option --${name}. Check its spelling against the script's usage.`);
    if (booleans.includes(k)) {
      if (v !== undefined) throw new Fail(`--${name} takes no value (got --${name}=${v}).`);
      v = true;
    } else if (v === undefined) v = i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    if (lists.includes(k)) (out[k] ||= []).push(v);
    else out[k] = v;
  }
  return out;
}
