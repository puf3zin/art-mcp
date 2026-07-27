# art-mcp

[![npm](https://img.shields.io/npm/v/art-mcp)](https://www.npmjs.com/package/art-mcp)
[![Nightly smoke test](https://github.com/puf3zin/art-mcp/actions/workflows/smoke.yml/badge.svg)](https://github.com/puf3zin/art-mcp/actions/workflows/smoke.yml)

An [MCP](https://modelcontextprotocol.io) server for searching museum collections and viewing artwork images and metadata — right inside Claude (or any MCP client).

It works out of the box with seven sources that need **no API key**, and can pull in three more if you provide free keys.

## Sources

| Source | `source` id | Strongest in | API key |
| --- | --- | --- | --- |
| The Metropolitan Museum of Art | `met` | Encyclopaedic | none |
| Art Institute of Chicago | `artic` | European & American | none |
| Cleveland Museum of Art | `cleveland` | European & American | none |
| Rijksmuseum | `rijksmuseum` | Dutch Golden Age | none |
| Victoria and Albert Museum | `vam` | Chinese, Japanese, Korean, South & SE Asian, Islamic, African | none |
| Japan Search | `japansearch` | Japanese art, prints, manuscripts | none |
| Wikidata / Wikimedia Commons | `wikidata` | Latin America and anywhere without a museum API | none |
| Harvard Art Museums | `harvard` | Encyclopaedic | free ([request one](https://docs.google.com/forms/d/1Fe1H4nOhFkrLpaeBpLAnSrIMYvcAxnYWm0IU9a6IkFA/viewform)) |
| Smithsonian Open Access | `smithsonian` | African, Asian, Indigenous American | free ([sign up](https://api.data.gov/signup/)) |
| Museum of New Zealand Te Papa Tongarewa | `tepapa` | Taonga Māori, Pacific Cultures | free ([register](https://data.tepapa.govt.nz/docs/register.html)) |

### Looking beyond Europe and the United States

The first four sources are all Western institutions, which meant non-Western art was only
visible through a collecting museum's Asian or African department. The six added since
address that directly, but the coverage is uneven in ways worth knowing up front:

- **Asia is well served.** `vam` and `japansearch` are both keyless, and `smithsonian`
  adds the National Museum of Asian Art.
- **Africa** runs mainly through `smithsonian` (`unit_code:NMAfA`) and `vam`. There is no
  Africa-based institutional API to point at — [Digital Benin](https://digitalbenin.org)
  is the most significant African digital archive but publishes no public API, and the
  British Museum's SPARQL endpoint no longer resolves.
- **South America has no museum API at all.** Not one Latin American institution
  publishes a usable collections API. Brazil's federal museums run
  [Tainacan](https://tainacan.org/) as one WordPress site per museum with no central
  index and patchy images; Mexico's Mediateca INAH now redirects to a bare repository.
  So the region is covered by `smithsonian` (`unit_code:NMAI`, for Andean and Amazonian
  material) and by `wikidata`, which reaches Brazilian and Latin American painting
  through Wikimedia Commons. This is a real gap, not an oversight — worth revisiting as
  digitisation programmes there mature.

### Why there is no Google Arts & Culture source

It has no public read API. The only developer-facing programme, Large Scale Data, is a
pipeline for institutions to publish *into* the platform, and
`artsandculture.google.com/robots.txt` explicitly disallows `/api/*`, so the internal
endpoint is off-limits on both robots and terms-of-service grounds. Going direct to the
institutions that publish their own open data — which is what most of the sources above
are — gets the same collections without the problem.

### A note on Smithsonian

One adapter covers 21 museums, so narrowing helps. The API accepts Solr-style field
filters straight in the query string: `unit_code:NMAfA` (African Art), `unit_code:FSG`
(Freer and Sackler, Asian art), `unit_code:NMAI` (American Indian).

Write the filter as a plain `AND` term — `Nasca AND unit_code:NMAI`. Wrapping free text
and a field filter in parentheses makes EDAN drop the filter and match most of the
institution.

`DEMO_KEY` works for a first try but is capped at 10 requests/hour.

**NMAI is metadata-only in practice.** Its records are flagged as having images, but the
API returns no media for them — not in search results and not on the detail endpoint —
which is consistent with the museum's cultural protocols around Indigenous material. So
`unit_code:NMAI` is genuinely useful for finding and reading about Andean and Amazonian
works, and `get_artwork_image` will almost always come up empty for them. NMAfA and FSG
both serve images normally.

### A note on Japan Search

[Japan Search](https://jpsearch.go.jp/) is the National Diet Library's cross-sector
aggregator — national museums, university archives and prefectural collections behind one
index. It catalogs **in Japanese and has no English titles**, so query it in Japanese
(`北斎`, `浮世絵`) for decent recall. Results come back with `language: "ja"` and the
native title in `titleOriginal`; that is correct output, not a failure. It is also the
only source that reports a real per-object licence, which lands in `license`.

### A note on Wikidata

This is a fallback for regions no museum API reaches, not a curated catalogue. Metadata
quality varies far more per item than a museum's own records, and a search resolves the
keyword to an entity and then returns works *by* it — so it answers "Tarsila do Amaral"
well and a subject phrase badly. Images come from Wikimedia Commons.

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

### Adding API keys

All optional — seven sources work without any key. The server reads keys from the process
environment, so pass them through your MCP client's `env` block; a bare `.env` file is
**not** loaded automatically.

```json
{
  "mcpServers": {
    "art-mcp": {
      "command": "npx",
      "args": ["-y", "art-mcp"],
      "env": {
        "HARVARD_API_KEY": "your-key-here",
        "SMITHSONIAN_API_KEY": "your-key-here",
        "TEPAPA_API_KEY": "your-key-here"
      }
    }
  }
}
```

`SMITHSONIAN_API_KEY` is the one most worth setting: it is instant and self-service from
[api.data.gov](https://api.data.gov/signup/), and it is what unlocks the African, Asian
and Indigenous American collections.

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
