import { mapLimit } from "../lib/concurrency.js";
import { FULL_WIDTH, THUMB_WIDTH, iiifAtWidth } from "../lib/iiif.js";
import { getJson } from "../lib/http.js";
import type { Artwork, ArtworkDetail, Provider } from "../types.js";

// Rijksmuseum Data Services. The old www.rijksmuseum.nl/api endpoint (and the
// API keys that went with it) was retired and now answers 410 Gone.
const SEARCH = "https://data.rijksmuseum.nl/search/collection";
const ID_BASE = "https://id.rijksmuseum.nl";

// Results are Linked Art, which leans on Getty AAT vocabulary ids rather than
// named fields, so the interesting bits have to be looked up by concept.
const AAT = {
  english: "http://vocab.getty.edu/aat/300388277",
  primaryTitle: "http://vocab.getty.edu/aat/300417200",
  creatorDescription: "http://vocab.getty.edu/aat/300435416",
  objectNumber: "http://vocab.getty.edu/aat/300312355",
  description: "http://vocab.getty.edu/aat/300048722",
  htmlPage: "http://vocab.getty.edu/aat/300264578",
  centimetres: "http://vocab.getty.edu/aat/300379098",
} as const;

/** The search API caps a page at 100 and has no free-text parameter. */
const MAX_PAGE = 100;

/** Fields the search endpoint will match a keyword against. */
const QUERY_FIELDS = ["title", "creator", "description"] as const;

// --- Linked Art shapes (only the parts we read) ------------------------------

interface Notation {
  "@language"?: string;
  "@value"?: string;
}

interface Ref {
  id?: string;
  type?: string;
  content?: string;
  value?: string;
  notation?: Notation[];
  classified_as?: Ref[];
  language?: Ref[];
  identified_by?: Ref[];
  referred_to_by?: Ref[];
  carried_out_by?: Ref[];
  digitally_carried_by?: Ref[];
  digitally_shown_by?: Ref[];
  access_point?: Ref[];
  part?: Ref[];
  unit?: Ref;
  format?: string;
}

interface LinkedArtObject extends Ref {
  produced_by?: Ref & { timespan?: Ref; part?: Ref[] };
  subject_of?: Ref[];
  shows?: Ref[];
  dimension?: Ref[];
  made_of?: Ref[];
  current_location?: Ref;
}

interface SearchResponse {
  orderedItems?: { id?: string }[];
}

// --- Linked Art helpers ------------------------------------------------------

/** Strip the URI prefix so ids round-trip through `get_artwork`. */
function localId(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const m = uri.match(/([^/]+)\/?$/);
  return m ? m[1] : undefined;
}

function isClassified(node: Ref | undefined, aat: string): boolean {
  return (node?.classified_as ?? []).some((c) => c.id === aat);
}

function isEnglish(node: Ref | undefined): boolean {
  return (node?.language ?? []).some((l) => l.id === AAT.english);
}

/** Read a `notation` array, preferring the English entry. */
function notation(node: Ref | undefined): string | undefined {
  const list = node?.notation ?? [];
  const en = list.find((n) => n["@language"] === "en");
  return (en ?? list[0])?.["@value"] || undefined;
}

/**
 * Pick one entry from a list of language-tagged nodes, preferring English but
 * falling back to whatever exists — many records are Dutch-only.
 */
function preferEnglish(nodes: Ref[]): Ref | undefined {
  return nodes.find(isEnglish) ?? nodes[0];
}

function titleOf(o: LinkedArtObject): string {
  const names = (o.identified_by ?? []).filter((n) => n.type === "Name");
  const primary = names.filter((n) => isClassified(n, AAT.primaryTitle));
  const chosen = preferEnglish(primary.length ? primary : names);
  return chosen?.content || "Untitled";
}

function artistOf(o: LinkedArtObject): string | undefined {
  // Creators hang off sub-productions, each with its own role.
  const names = (o.produced_by?.part ?? [])
    .flatMap((p) => p.carried_out_by ?? [])
    .map((person) => notation(person))
    .filter((n): n is string => Boolean(n));
  if (names.length) return [...new Set(names)].join(", ");

  // Fall back to the free-text creator line ("painter: Rembrandt van Rijn").
  const described = (o.produced_by?.referred_to_by ?? []).filter((r) =>
    isClassified(r, AAT.creatorDescription),
  );
  return preferEnglish(described)?.content || undefined;
}

function dateOf(o: LinkedArtObject): string | undefined {
  const names = (o.produced_by?.timespan?.identified_by ?? []).filter(
    (n) => n.type === "Name",
  );
  return preferEnglish(names)?.content || undefined;
}

function objectNumberOf(o: LinkedArtObject): string | undefined {
  const ids = (o.identified_by ?? []).filter(
    (n) => n.type === "Identifier" && isClassified(n, AAT.objectNumber),
  );
  return ids[0]?.content || undefined;
}

function museumUrlOf(o: LinkedArtObject): string | undefined {
  for (const s of o.subject_of ?? []) {
    for (const carrier of s.digitally_carried_by ?? []) {
      if (carrier.format === "text/html" || isClassified(carrier, AAT.htmlPage)) {
        const url = carrier.access_point?.[0]?.id;
        if (url) return url;
      }
    }
  }
  return undefined;
}

function descriptionOf(o: LinkedArtObject): string | undefined {
  const texts: Ref[] = [];
  const walk = (nodes: Ref[]) => {
    for (const n of nodes) {
      if (n.content && isClassified(n, AAT.description)) texts.push(n);
      if (n.part) walk(n.part);
    }
  };
  walk(o.subject_of ?? []);
  return preferEnglish(texts)?.content || undefined;
}

/** Where the object hangs, e.g. "Main building, 17th Century". */
function galleryOf(o: LinkedArtObject): string | undefined {
  const names = (o.current_location?.identified_by ?? []).filter(
    (n) => n.type === "Name",
  );
  const chosen = preferEnglish(names);
  const parts = (chosen?.part ?? [])
    .map((p) => p.content)
    .filter((c): c is string => Boolean(c));
  return parts.length ? parts.join(", ") : chosen?.content || undefined;
}

function mediumOf(o: LinkedArtObject): string | undefined {
  const materials = (o.made_of ?? [])
    .map((m) => notation(m))
    .filter((n): n is string => Boolean(n));
  return materials.length ? materials.join(", ") : undefined;
}

function dimensionsOf(o: LinkedArtObject): string | undefined {
  const parts = (o.dimension ?? [])
    .map((d) => {
      const label = notation(d.classified_as?.[0]);
      if (!label || !d.value) return undefined;
      const unit = d.unit?.id === AAT.centimetres ? " cm" : "";
      return `${label} ${d.value}${unit}`;
    })
    .filter((p): p is string => Boolean(p));
  return parts.length ? parts.join("; ") : undefined;
}

// --- Image resolution --------------------------------------------------------

/**
 * Images sit three hops away: object → VisualItem → DigitalObject → IIIF URL.
 * Returns undefined rather than throwing, so a missing image never fails a
 * whole search.
 */
async function resolveImage(o: LinkedArtObject): Promise<string | undefined> {
  const visualItemId = o.shows?.[0]?.id;
  if (!visualItemId) return undefined;
  try {
    const visual = await getJson<Ref>(visualItemId);
    const digitalId = visual.digitally_shown_by?.[0]?.id;
    if (!digitalId) return undefined;
    const digital = await getJson<Ref>(digitalId);
    return digital.access_point?.[0]?.id || undefined;
  } catch {
    return undefined;
  }
}

// --- Fetching ----------------------------------------------------------------

async function fetchObject(id: string): Promise<LinkedArtObject> {
  return getJson<LinkedArtObject>(`${ID_BASE}/${encodeURIComponent(id)}`);
}

function toCompact(o: LinkedArtObject, id: string, imageUrl?: string): Artwork {
  return {
    source: "rijksmuseum",
    id,
    title: titleOf(o),
    artist: artistOf(o),
    date: dateOf(o),
    imageUrl: iiifAtWidth(imageUrl, FULL_WIDTH),
    thumbnailUrl: iiifAtWidth(imageUrl, THUMB_WIDTH),
    museumUrl: museumUrlOf(o),
  };
}

export const rijksmuseumProvider: Provider = {
  id: "rijksmuseum",
  name: "Rijksmuseum",

  isAvailable() {
    // Data Services is open — no API key.
    return true;
  },

  async search(query, limit) {
    // There is no free-text parameter, so fan the keyword across the fields
    // that do accept one and merge, preserving field order as a crude ranking.
    const pages = await Promise.allSettled(
      QUERY_FIELDS.map((field) => {
        const url = `${SEARCH}?${field}=${encodeURIComponent(
          query,
        )}&imageAvailable=true`;
        return getJson<SearchResponse>(url);
      }),
    );

    const perField = pages.map((page) =>
      page.status === "fulfilled"
        ? (page.value.orderedItems ?? [])
            .map((item) => localId(item.id))
            .filter((id): id is string => Boolean(id))
        : [],
    );

    // Interleave the per-field hits so one field can't crowd out the others —
    // a bare artist name should surface works *by* them, not just *about* them.
    const ids: string[] = [];
    const seen = new Set<string>();
    const deepest = Math.max(0, ...perField.map((f) => f.length));
    for (let rank = 0; rank < deepest; rank++) {
      for (const field of perField) {
        const id = field[rank];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }

    if (!ids.length) {
      if (pages.every((p) => p.status === "rejected")) {
        const reason = pages[0].status === "rejected" ? pages[0].reason : undefined;
        throw new Error(
          `Rijksmuseum search failed: ${
            reason instanceof Error ? reason.message : String(reason)
          }`,
        );
      }
      return [];
    }

    // Search returns bare ids, so every result costs a lookup. Fetch only as
    // many as the caller asked for, with bounded concurrency.
    const wanted = ids.slice(0, Math.min(limit, MAX_PAGE));
    const settled = await mapLimit(wanted, 6, async (id) => {
      try {
        const o = await fetchObject(id);
        return toCompact(o, id, await resolveImage(o));
      } catch {
        return undefined;
      }
    });

    return settled.filter((a): a is Artwork => a !== undefined);
  },

  async getArtwork(id) {
    const o = await fetchObject(id);
    const imageUrl = await resolveImage(o);
    const detail: ArtworkDetail = {
      ...toCompact(o, id, imageUrl),
      medium: mediumOf(o),
      dimensions: dimensionsOf(o),
      department: galleryOf(o),
      creditLine: objectNumberOf(o),
      description: descriptionOf(o),
    };
    return detail;
  },
};
