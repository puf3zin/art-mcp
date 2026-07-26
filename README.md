# art-mcp

[![npm](https://img.shields.io/npm/v/art-mcp)](https://www.npmjs.com/package/art-mcp)
[![Nightly smoke test](https://github.com/puf3zin/art-mcp/actions/workflows/smoke.yml/badge.svg)](https://github.com/puf3zin/art-mcp/actions/workflows/smoke.yml)

An [MCP](https://modelcontextprotocol.io) server for searching museum collections and viewing artwork images and metadata — right inside Claude (or any MCP client).

It works out of the box with four museums that need **no API key**, and can pull in one more if you provide a free key.

## Sources

| Source | `source` id | API key |
| --- | --- | --- |
| The Metropolitan Museum of Art | `met` | none |
| Art Institute of Chicago | `artic` | none |
| Cleveland Museum of Art | `cleveland` | none |
| Rijksmuseum | `rijksmuseum` | none |
| Harvard Art Museums | `harvard` | free ([request one](https://docs.google.com/forms/d/1Fe1H4nOhFkrLpaeBpLAnSrIMYvcAxnYWm0IU9a6IkFA/viewform)) |

### A note on Rijksmuseum

This uses [Rijksmuseum Data Services](https://data.rijksmuseum.nl/docs/), which needs no
key — the older `www.rijksmuseum.nl/api` endpoint was retired and now answers `410 Gone`.

The new API serves [Linked Art](https://linked.art/) and has **no free-text search
parameter**, so `search_artworks` fans the keyword across `title`, `creator`, and
`description` and interleaves the hits. Search also returns bare identifiers, so each
result costs a follow-up lookup (plus two more to resolve its image) — expect Rijksmuseum
to be the slowest source in an all-museum search.

### A note on Art Institute of Chicago

Search and metadata work, but the IIIF image host sits behind a Cloudflare bot
challenge, so `get_artwork_image` will usually fail for `artic` with a 403.

## Tools

- **`list_sources`** — which museums are queryable right now.
- **`search_artworks`** `{ query, source?, limit? }` — search one source or all of them; returns compact results with a `source` + `id` for each.
- **`get_artwork`** `{ source, id }` — full metadata for one artwork.
- **`get_artwork_image`** `{ source, id }` — downloads the image and returns it so the model can actually see it.

## Connect to Claude

No install step — `npx` fetches the package on demand.

### Claude Code

```bash
claude mcp add art-mcp -- npx -y art-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "art-mcp": {
      "command": "npx",
      "args": ["-y", "art-mcp"]
    }
  }
}
```

Restart the client, then try: *"Search the Met for Van Gogh and show me an image."*

### Adding a Harvard key

Optional — the other four sources work without it. The server reads the key from the
process environment, so pass it through your MCP client's `env` block; a bare `.env` file
is **not** loaded automatically.

```json
{
  "mcpServers": {
    "art-mcp": {
      "command": "npx",
      "args": ["-y", "art-mcp"],
      "env": {
        "HARVARD_API_KEY": "your-key-here"
      }
    }
  }
}
```

## Reliability

Museum APIs rot quietly. The Rijksmuseum endpoint this server was originally built on was
retired and started answering `410 Gone` with no announcement — the kind of break that
only surfaces when a user hits it.

So a [nightly workflow](.github/workflows/smoke.yml) runs the full
search → detail → image path against every live API and opens an issue when a source that
used to work stops working. Run it yourself with:

```bash
npm run smoke
```

Known-broken checks (currently the Art Institute's Cloudflare-blocked images) are reported
but don't fail the run, so a red badge always means something new actually broke.

## Development

```bash
npm install
npm run build     # compile to dist/
npm run dev       # run from source with tsx
npm run inspect   # build + open the MCP Inspector
npm run smoke     # exercise every provider against the live APIs
```

## License

MIT
