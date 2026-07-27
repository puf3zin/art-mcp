import { createRequire } from "node:module";

/**
 * The package version, read once from package.json.
 *
 * 0.2.0 shipped announcing itself as 0.1.0 over MCP because the number was
 * written out in three places and only one of them got bumped. Everything that
 * needs it imports it from here instead.
 *
 * The relative path resolves identically from `src/` under tsx and from `dist/`
 * once built, so this module must stay at the top level of either — a copy in
 * `lib/` would look one directory too deep.
 */
export const VERSION: string = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version;
