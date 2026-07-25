# art-mcp

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

## Setup

```bash
npm install
npm run build
```

Optionally, add a Harvard key to enable that source. Note the server reads it from the
process environment (`HARVARD_API_KEY`), so pass it through your MCP client's `env` block
as shown below — a bare `.env` file is not loaded automatically.

## Connect to Claude

### Claude Code

```bash
claude mcp add art-mcp -- node /absolute/path/to/art-mcp/dist/index.js
```

### Claude Desktop

Add to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "art-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/art-mcp/dist/index.js"],
      "env": {
        "HARVARD_API_KEY": ""
      }
    }
  }
}
```

Restart the client, then try: *"Search the Met for Van Gogh and show me an image."*

## Development

```bash
npm run dev       # run from source with tsx
npm run inspect   # build + open the MCP Inspector
```

## License

MIT
