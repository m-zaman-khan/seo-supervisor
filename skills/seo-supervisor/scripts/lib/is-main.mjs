// True when the module at importMetaUrl is the script node was started with, also when it was started through a
// symlink or a Windows junction (node runs the real file, process.argv[1] keeps the typed path).
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isMain(importMetaUrl) {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}
