import { FULL_WIDTH, THUMB_WIDTH } from "../lib/iiif.js";
import { getJson } from "../lib/http.js";
import type { Artwork, ArtworkDetail, Provider } from "../types.js";

// Wikidata is the fallback for regions no museum API reaches. Most of Latin
// America, much of Africa and large parts of Asia have no institutional
// collections API at all, but their holdings are catalogued here and the images
// sit on Wikimedia Commons. Metadata quality varies by item far more than a
// museum's own catalogue would.
const SPARQL = "https://query.wikidata.org/sparql";

// The query service rejects generic user agents, and long queries can be slow.
const ACCEPT = "application/sparql-results+json";
const TIMEOUT_MS = 45_000;

/**
 * Language fallback chain for labels. English first because that is what most
 * clients expect, then the languages of the regions this source exists to cover.
 */
const LANGUAGES = "en,pt,es,ja,zh,ar,hi,fr";

interface SparqlValue {
  value: string;
  "xml:lang"?: string;
}

interface SparqlResponse<K extends string> {
  results?: { bindings?: Partial<Record<K, SparqlValue>>[] };
}

/** Escape a user string for interpolation into a SPARQL string literal. */
function sparqlString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n\t]/g, " ");
}

/** Q-number out of an entity URI, e.g. ".../entity/Q42714162" → "Q42714162". */
function qid(uri: string | undefined): string | undefined {
  return uri?.match(/(Q\d+)$/)?.[1];
}

/**
 * Commons `Special:FilePath` serves the original, which can be enormous.
 * `?width=` asks the thumbnailer for a bounded copy instead.
 */
function commonsImage(url: string | undefined, width: number): string | undefined {
  if (!url) return undefined;
  return `${url.replace(/^http:/, "https:")}?width=${width}`;
}

function text(v: SparqlValue | undefined): string | undefined {
  return v?.value || undefined;
}

/** Trim a Wikidata date literal ("1928-01-01T00:00:00Z") down to the year. */
function year(v: SparqlValue | undefined): string | undefined {
  return v?.value?.match(/^(-?\d{1,4})-/)?.[1] || text(v);
}

async function runQuery<K extends string>(
  query: string,
): Promise<Partial<Record<K, SparqlValue>>[]> {
  const url = `${SPARQL}?query=${encodeURIComponent(query)}`;
  const res = await getJson<SparqlResponse<K>>(url, {
    headers: { Accept: ACCEPT },
    timeoutMs: TIMEOUT_MS,
  });
  return res.results?.bindings ?? [];
}

/**
 * Resolve the keyword through Wikidata's entity search, then take works *by*
 * whatever it matched. Searching for "Tarsila do Amaral" should return her
 * paintings, not her biography.
 *
 * Deliberately no `wdt:P31/wdt:P279* wd:Q838948` class filter — the transitive
 * subclass walk pushes this query past the query service's timeout on anything
 * but the smallest result sets. Requiring a creator (P170) and an image (P18)
 * is a cheaper filter that keeps out almost everything that is not a work.
 */
function searchQuery(query: string, limit: number): string {
  return `
SELECT ?item ?itemLabel ?creatorLabel ?image ?inception WHERE {
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:api "EntitySearch" .
    bd:serviceParam wikibase:endpoint "www.wikidata.org" .
    bd:serviceParam mwapi:search "${sparqlString(query)}" .
    bd:serviceParam mwapi:language "en" .
    ?hit wikibase:apiOutputItem mwapi:item .
  }
  ?item wdt:P170 ?hit .
  ?item wdt:P18 ?image .
  OPTIONAL { ?item wdt:P170 ?creator . }
  OPTIONAL { ?item wdt:P571 ?inception . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${LANGUAGES}". }
} LIMIT ${limit}`;
}

function detailQuery(id: string): string {
  return `
SELECT ?itemLabel ?itemDescription ?creatorLabel ?image ?inception
       ?materialLabel ?collectionLabel ?countryLabel ?copyrightLabel WHERE {
  BIND(wd:${id} AS ?item)
  OPTIONAL { ?item wdt:P18 ?image . }
  OPTIONAL { ?item wdt:P170 ?creator . }
  OPTIONAL { ?item wdt:P571 ?inception . }
  OPTIONAL { ?item wdt:P186 ?material . }
  OPTIONAL { ?item wdt:P195 ?collection . }
  OPTIONAL { ?item wdt:P495 ?country . }
  OPTIONAL { ?item wdt:P6216 ?copyright . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${LANGUAGES}". }
} LIMIT 50`;
}

type SearchKey = "item" | "itemLabel" | "creatorLabel" | "image" | "inception";
type DetailKey =
  | "itemLabel"
  | "itemDescription"
  | "creatorLabel"
  | "image"
  | "inception"
  | "materialLabel"
  | "collectionLabel"
  | "countryLabel"
  | "copyrightLabel";

export const wikidataProvider: Provider = {
  id: "wikidata",
  name: "Wikidata / Wikimedia Commons",

  isAvailable() {
    return true;
  },

  async search(query, limit) {
    const bindings = await runQuery<SearchKey>(searchQuery(query, limit));

    const seen = new Set<string>();
    const results: Artwork[] = [];
    for (const b of bindings) {
      const id = qid(b.item?.value);
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const label = b.itemLabel;
      results.push({
        source: "wikidata",
        id,
        title: text(label) || "Untitled",
        // Labels come back in whichever language of the fallback chain exists,
        // so the tag is the only way to know what was actually returned.
        language: label?.["xml:lang"],
        artist: text(b.creatorLabel),
        date: year(b.inception),
        imageUrl: commonsImage(b.image?.value, FULL_WIDTH),
        thumbnailUrl: commonsImage(b.image?.value, THUMB_WIDTH),
        museumUrl: `https://www.wikidata.org/wiki/${id}`,
      });
    }
    return results;
  },

  async getArtwork(id) {
    if (!/^Q\d+$/.test(id)) {
      throw new Error(`Not a Wikidata item id: ${id} (expected e.g. Q42714162)`);
    }

    const bindings = await runQuery<DetailKey>(detailQuery(id));
    if (!bindings.length) throw new Error(`No Wikidata item ${id}`);

    // Optional multi-valued properties produce one row per combination, so
    // collapse the rows back into a single record.
    const pick = (key: DetailKey) =>
      text(bindings.find((b) => b[key] !== undefined)?.[key]);
    const all = (key: DetailKey) => {
      const values = bindings
        .map((b) => text(b[key]))
        .filter((v): v is string => Boolean(v));
      return values.length ? [...new Set(values)].join(", ") : undefined;
    };

    const label = bindings.find((b) => b.itemLabel !== undefined)?.itemLabel;
    const image = pick("image");
    const country = pick("countryLabel");
    const copyright = pick("copyrightLabel");

    return {
      source: "wikidata",
      id,
      title: text(label) || "Untitled",
      language: label?.["xml:lang"],
      artist: all("creatorLabel"),
      date: year(bindings.find((b) => b.inception !== undefined)?.inception),
      imageUrl: commonsImage(image, FULL_WIDTH),
      thumbnailUrl: commonsImage(image, THUMB_WIDTH),
      museumUrl: `https://www.wikidata.org/wiki/${id}`,
      medium: all("materialLabel"),
      culture: country,
      originPlace: country,
      creditLine: all("collectionLabel"),
      isPublicDomain: copyright ? /public domain/i.test(copyright) : undefined,
      license: copyright,
      description: pick("itemDescription"),
    };
  },
};
