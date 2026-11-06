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

## Recent changes (2026-11-04/05)

All three are on `main` in the fork and sent upstream as separate PRs.

1. **Met search.** The Met retired `/v1/search` on 2026-10-01 (410 Gone).
   Search now uses `/v1.1/search` with a `limit`. `/objects/{id}` is still v1.
   Upstream: https://github.com/puf3zin/art-mcp/pull/2
2. **Cooper Hewitt links** (`smithsonian.ts`). `record_link` for CHNDM records
   points at a retired site that redirects to a generic page. Links are now
   `https://www.si.edu/object/<slug>:<record_ID>`; the slug is cosmetic.
   Checked in the app with the Giani drawings, accented and Chinese titles.
3. **Image size and timeouts.** `get_artwork_image` was fetching originals
   (12MB for a Smithsonian drawing), which overran Claude Desktop's 60s wait.
   Met and Smithsonian `imageUrl` are now web-sized; the original is
   `fullImageUrl` on `get_artwork`. The HTTP timeout now covers the response
   body (it used to stop at headers). Other sources were already bounded.

Not yet checked: Smithsonian links for units other than CHNDM (one per
`record_link` host), and the `edanmdm-` fallback in the Cooper Hewitt fix,
which assumes a record ID format that has not been confirmed.

## Known issues

- Art Institute of Chicago images return 403 (bot challenge).
- Smithsonian lookups by accession number (`chndm_1901-39-497`) return not
  found; `edanmdm:chndm_1901-39-497` works. Results show the `ld1-...` ID.
- `npm audit` reports vulnerabilities; not yet examined
  (`npm audit --omit=dev` shows only those in shipped code).

## Running locally

- Keys live in the macOS Keychain. Run with them via
  `~/bin/mcp-keychain.sh HARVARD_API_KEY SMITHSONIAN_API_KEY TEPAPA_API_KEY -- npm run smoke`
- Claude Desktop runs `dist/index.js`: `npm run build`, then Cmd+Q and reopen.
- Never print API responses unfiltered; some include the key in `next` links.

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
