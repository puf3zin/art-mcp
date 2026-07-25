#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fetchImage } from "./lib/image.js";
import { availableProviders, getProvider, providers } from "./providers/index.js";
import type { Artwork, Source } from "./types.js";
import { SOURCES } from "./types.js";

const sourceEnum = z.enum(SOURCES as [Source, ...Source[]]);

const server = new McpServer({
  name: "art-mcp",
  version: "0.1.0",
});

function textResult(data: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

// --- list_sources -----------------------------------------------------------
server.registerTool(
  "list_sources",
  {
    title: "List museum sources",
    description:
      "List the museum data sources this server can query and whether each is currently available. Sources needing an API key are unavailable until the key is configured.",
    inputSchema: {},
  },
  async () => {
    const list = providers.map((p) => ({
      source: p.id,
      name: p.name,
      available: p.isAvailable(),
    }));
    return textResult(list);
  },
);

// --- search_artworks --------------------------------------------------------
server.registerTool(
  "search_artworks",
  {
    title: "Search artworks",
    description:
      "Search museum collections for artworks. Returns compact results including a `source` and `id` used with get_artwork or get_artwork_image.\n\n" +
      "IMPORTANT — this matches keywords against catalog metadata; it is not semantic search. Artist names, titles, cultures, and periods work well. Descriptions of subject matter work badly: a query like 'man crossing a bridge' matches any record containing 'man', 'bridge', or names like 'Bridges' and 'Cross', and buries the relevant results.\n\n" +
      "So translate the user's intent into catalog vocabulary before calling. If you can name a likely artist, school, or title from your own knowledge, search for that instead — e.g. prefer 'Hokusai' or 'Hiroshige Tokaido' over 'japanese painting of a bridge'. Searching a subject phrase directly is a last resort; if you must, use one or two distinctive nouns rather than a sentence.\n\n" +
      "Results are ordered by each museum's own relevance ranking, which is often weak — scan the whole list rather than assuming the first hit is best.",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe(
          "Catalog keywords — ideally an artist name, title, culture, or period, e.g. 'Katsushika Hokusai' or 'Edo period landscape'. Avoid full sentences and subject descriptions.",
        ),
      source: sourceEnum
        .or(z.literal("all"))
        .optional()
        .describe(
          "A specific museum source, or 'all' (default) to search every available source. Note that 'rijksmuseum' has no free-text search and is the slowest source, so an all-source search costs a few seconds.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results per source (default 10)."),
    },
  },
  async ({ query, source, limit }) => {
    const perSource = limit ?? 10;
    const targets =
      !source || source === "all"
        ? availableProviders()
        : [getProvider(source)].filter(
            (p): p is NonNullable<typeof p> => p !== undefined && p.isAvailable(),
          );

    if (targets.length === 0) {
      return errorResult(
        source && source !== "all"
          ? `Source '${source}' is not available (missing API key?). Use list_sources to see what's available.`
          : "No sources are currently available.",
      );
    }

    const settled = await Promise.allSettled(
      targets.map((p) => p.search(query, perSource)),
    );

    const results: Artwork[] = [];
    const errors: string[] = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") {
        results.push(...r.value);
      } else {
        errors.push(`${targets[i].id}: ${r.reason?.message ?? r.reason}`);
      }
    });

    return textResult({
      count: results.length,
      results,
      ...(errors.length ? { errors } : {}),
    });
  },
);

// --- get_artwork ------------------------------------------------------------
server.registerTool(
  "get_artwork",
  {
    title: "Get artwork details",
    description:
      "Fetch full catalog details for a single artwork by its source and id (as returned by search_artworks) — medium, dimensions, department, culture, credit line, and public-domain status where the museum publishes them. Use this to confirm attribution or rights before relying on a work, since search results carry only a summary.",
    inputSchema: {
      source: sourceEnum.describe("The museum source the artwork belongs to."),
      id: z.string().min(1).describe("The provider-native artwork id from search results."),
    },
  },
  async ({ source, id }) => {
    const provider = getProvider(source);
    if (!provider) return errorResult(`Unknown source '${source}'.`);
    if (!provider.isAvailable())
      return errorResult(`Source '${source}' is not available (missing API key?).`);
    try {
      return textResult(await provider.getArtwork(id));
    } catch (err) {
      return errorResult(
        `Failed to fetch ${source}/${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);

// --- get_artwork_image ------------------------------------------------------
server.registerTool(
  "get_artwork_image",
  {
    title: "Get artwork image",
    description:
      "Download the image for a single artwork (by source and id) and return it so it can actually be viewed, plus a short caption. Use this whenever the user wants to see a work, or when you need to judge what a work actually depicts rather than trusting its title.\n\n" +
      "Not every record has an image, and the Art Institute ('artic') serves images from a host behind a bot challenge, so those usually fail with a 403 — prefer another source when you need to display something, and fall back to the museumUrl from search results if an image cannot be fetched.",
    inputSchema: {
      source: sourceEnum.describe("The museum source the artwork belongs to."),
      id: z.string().min(1).describe("The provider-native artwork id from search results."),
    },
  },
  async ({ source, id }) => {
    const provider = getProvider(source);
    if (!provider) return errorResult(`Unknown source '${source}'.`);
    if (!provider.isAvailable())
      return errorResult(`Source '${source}' is not available (missing API key?).`);

    let artwork;
    try {
      artwork = await provider.getArtwork(id);
    } catch (err) {
      return errorResult(
        `Failed to fetch ${source}/${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const url = artwork.imageUrl ?? artwork.thumbnailUrl;
    if (!url) {
      return errorResult(
        `No image available for ${source}/${id} ("${artwork.title}").`,
      );
    }

    try {
      const { base64, mimeType } = await fetchImage(url);
      const caption = [artwork.title, artwork.artist, artwork.date]
        .filter(Boolean)
        .join(" — ");
      return {
        content: [
          { type: "text" as const, text: caption || `${source}/${id}` },
          { type: "image" as const, data: base64, mimeType },
        ],
      };
    } catch (err) {
      return errorResult(
        `Failed to download image for ${source}/${id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logging; stdout is reserved for the MCP protocol.
  console.error("art-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting art-mcp:", err);
  process.exit(1);
});
