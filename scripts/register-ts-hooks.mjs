/**
 * Lets the smoke scripts import the app's TypeScript with Node's built-in type stripping, so they
 * need no extra dependencies. Import this file first, then load app modules with `await import()`.
 *
 * - maps the "@/" alias to the repo root
 * - adds the ".ts" extension that the app's imports leave out
 * - loads the app's .ts files as ES modules (skips Node's "typeless package.json" reparse warning)
 * - maps "server-only" to an empty module: these scripts are server code, and outside Next the
 *   package (when installed) throws on import
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const EMPTY_MODULE = "data:text/javascript,";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: EMPTY_MODULE, shortCircuit: true };
    const target = specifier.startsWith("@/") ? new URL(specifier.slice(2), ROOT).href : specifier;
    const isLocal = target.startsWith("file:") || target.startsWith(".");
    if (isLocal && !/\.[cm]?[jt]s$/.test(target)) {
      const withTs = new URL(`${target}.ts`, context.parentURL ?? ROOT);
      if (existsSync(fileURLToPath(withTs))) return nextResolve(withTs.href, context);
    }
    return nextResolve(target, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(ROOT.href) && url.endsWith(".ts")) {
      return nextLoad(url, { ...context, format: "module-typescript" });
    }
    return nextLoad(url, context);
  },
});
