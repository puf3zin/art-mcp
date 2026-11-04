# Handover

Last updated: 2026-11-04

## What this is

Kim's fork of `puf3zin/art-mcp`: an MCP server that searches museum
collections. Fork is `mildlydiverting/art-mcp` (remote `origin`); the original
is remote `upstream`.

## Layout

- `src/providers/*.ts`: one file per museum source. `index.ts` lists them all.
- `src/lib/`: shared helpers (HTTP, images, IIIF, concurrency).
- `src/scripts/smoke.ts`: live smoke test. Run with `npm run smoke`.
- `.env.example`: shows which API keys exist.

## Sources (10)

`met`, `artic`, `cleveland`, `rijksmuseum`, `vam`, `japansearch`, `wikidata`
need no key. `harvard`, `smithsonian`, `tepapa` need a key in `.env`
(`HARVARD_API_KEY`, `SMITHSONIAN_API_KEY`, `TEPAPA_API_KEY`). A source with
no key is skipped, not an error.

## Recent change

The Met retired `/v1/search` on 2026-10-01 (it returns 410 Gone). Fixed by
moving search to `/v1.1/search` with a `limit`. `/objects/{id}` is still on v1.

- On `main` in the fork.
- Sent upstream as https://github.com/puf3zin/art-mcp/pull/2 (branch
  `fix/met-search-v1.1`). Not yet merged at time of writing.

## Gotchas

- Run `npm install` before `npx tsc --noEmit`; `node_modules` may be missing.
- Don't commit `package-lock.json` changes that `npm install` makes by accident.
- Keep PR branches off `main`: branch from `upstream/main` so only the fix goes
  upstream. This fork's `main` may carry commits upstream doesn't want.
- Other sources may break the same way the Met did. Run `npm run smoke` to
  check them (it makes live calls).
- Rebuild and restart the MCP server after changes, or the client keeps
  running old code.

## Kim's preferences

British English. Short, structured answers. Ask one question at a time. Get
approval before significant rewrites or new files over ~50 lines.
