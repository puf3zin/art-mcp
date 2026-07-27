import { getJson } from "../lib/http.js";
import type { Artwork, ArtworkDetail, Provider } from "../types.js";

// Smithsonian Open Access spans 21 museums behind one index, which is why it is
// a single provider rather than three. The unit codes that matter most for
// collections outside Europe and the US are worth knowing when narrowing a
// query with `unit_code:`:
//
//   NMAfA  National Museum of African Art
//   FSG    Freer Gallery / Arthur M. Sackler (National Museum of Asian Art)
//   NMAI   National Museum of the American Indian
const BASE = "https://api.si.edu/openaccess/api/v1.0";

function apiKey(): string | undefined {
  return process.env.SMITHSONIAN_API_KEY?.trim() || undefined;
}

// --- EDAN shapes (only the parts we read) ------------------------------------

interface Labelled {
  label?: string;
  content?: string;
}

interface EdanResource {
  label?: string;
  url?: string;
}

interface EdanMedia {
  type?: string;
  content?: string;
  thumbnail?: string;
  usage?: { access?: string };
  resources?: EdanResource[];
  extDescrAccessibility?: string;
}

interface EdanRow {
  id: string;
  title?: string;
  unitCode?: string;
  content?: {
    freetext?: Record<string, Labelled[]>;
    indexedStructured?: Record<string, string[]>;
    descriptiveNonRepeating?: {
      record_link?: string;
      guid?: string;
      unit_code?: string;
      online_media?: { media?: EdanMedia[] };
    };
  };
}

interface EdanSearchResponse {
  response?: { rows?: EdanRow[] };
}

interface EdanContentResponse {
  response?: EdanRow;
}

// --- Helpers -----------------------------------------------------------------

/**
 * Labels that identify who *made* the thing, most specific first.
 *
 * The `name` list also carries donors, collectors and previous owners. Falling
 * back to whichever name comes first attributes a Nasca vessel to the US
 * general who donated it, so an unrecognised label yields no artist at all.
 */
const MAKER_LABELS = [
  "Maker",
  "Artist",
  "Artist/maker",
  "Artist/Maker",
  "Creator",
  "Manufacturer",
  "Designer",
  "Author",
  "Photographer",
  "Weaver",
  "Potter",
  "Sculptor",
  "Painter",
];

function freetext(row: EdanRow, field: string): Labelled[] {
  return row.content?.freetext?.[field] ?? [];
}

function structured(row: EdanRow, field: string): string | undefined {
  const values = (row.content?.indexedStructured?.[field] ?? []).filter(Boolean);
  return values.length ? [...new Set(values)].join(", ") : undefined;
}

function artistOf(row: EdanRow): string | undefined {
  const names = freetext(row, "name");
  for (const label of MAKER_LABELS) {
    const hit = names.find((n) => n.label === label)?.content;
    if (hit) return hit;
  }
  // Deliberately no fallback — see MAKER_LABELS. Unattributed is correct for a
  // great deal of the ethnographic material in NMAI and NMAfA anyway.
  return undefined;
}

/** First entry in `field` whose label matches one of `labels`, in order. */
function labelled(
  row: EdanRow,
  field: string,
  ...labels: string[]
): string | undefined {
  const entries = freetext(row, field);
  for (const label of labels) {
    const hit = entries.find((n) => n.label === label)?.content;
    if (hit) return hit;
  }
  return undefined;
}

function firstMedia(row: EdanRow): EdanMedia | undefined {
  const media = row.content?.descriptiveNonRepeating?.online_media?.media ?? [];
  return media.find((m) => m.type === "Images") ?? media[0];
}

function imagesOf(row: EdanRow) {
  const media = firstMedia(row);
  if (!media) return {};
  const highRes = media.resources?.find((r) =>
    /high[- ]?resolution/i.test(r.label ?? ""),
  )?.url;
  return {
    imageUrl: highRes ?? media.content ?? media.thumbnail,
    thumbnailUrl: media.thumbnail ?? media.content,
  };
}

function museumUrlOf(row: EdanRow): string | undefined {
  const dnr = row.content?.descriptiveNonRepeating;
  // record_link is the museum's own object page; guid is an ARK that resolves
  // to the same place and is present far more often.
  return dnr?.record_link || dnr?.guid || undefined;
}

function toCompact(row: EdanRow): Artwork {
  return {
    source: "smithsonian",
    id: row.id,
    title: row.title || "Untitled",
    artist: artistOf(row),
    date: freetext(row, "date")[0]?.content || undefined,
    ...imagesOf(row),
    museumUrl: museumUrlOf(row),
  };
}

function toDetail(row: EdanRow): ArtworkDetail {
  const access = firstMedia(row)?.usage?.access;
  const isCC0 = access?.toUpperCase() === "CC0";
  return {
    ...toCompact(row),
    // Prefer a stated medium; object_type ("Masks") is a shape, not a material,
    // so it is only a fallback.
    medium:
      labelled(row, "physicalDescription", "Medium", "Materials", "Material") ??
      structured(row, "object_type"),
    dimensions: labelled(row, "physicalDescription", "Dimensions", "Measurements"),
    department: row.unitCode || row.content?.descriptiveNonRepeating?.unit_code,
    // indexedStructured.topic is subject matter ("Antelope", "Men") — reading it
    // as culture would mislabel what a work depicts as who made it.
    culture:
      labelled(row, "culture", "Culture", "Ethnic Group", "Nationality") ??
      structured(row, "culture"),
    originPlace:
      structured(row, "place") ?? labelled(row, "place", "Geography", "Place"),
    creditLine: freetext(row, "creditLine")[0]?.content || undefined,
    isPublicDomain: access ? isCC0 : undefined,
    license: access || undefined,
    description:
      labelled(row, "notes", "Description", "Label Text", "Summary") ??
      firstMedia(row)?.extDescrAccessibility,
  };
}

export const smithsonianProvider: Provider = {
  id: "smithsonian",
  name: "Smithsonian Open Access",

  isAvailable() {
    return apiKey() !== undefined;
  },

  async search(query, limit) {
    const key = apiKey();
    if (!key) throw new Error("SMITHSONIAN_API_KEY is not set");
    // Most of the index is specimens and archival records with no picture;
    // without this filter an image search mostly returns things to read.
    //
    // Join with AND rather than wrapping the caller's query in parentheses.
    // EDAN loosens a parenthesised group containing both free text and a field
    // term into something OR-like: `(Nasca vessel unit_code:NMAI) AND ...`
    // matches 283k records across the whole institution and silently drops the
    // unit filter, while the AND-joined form returns 17, all of them NMAI.
    const q = `${query} AND online_media_type:"Images"`;
    const url = `${BASE}/search?q=${encodeURIComponent(
      q,
    )}&rows=${limit}&api_key=${encodeURIComponent(key)}`;
    const res = await getJson<EdanSearchResponse>(url);
    return (res.response?.rows ?? []).map(toCompact);
  },

  async getArtwork(id) {
    const key = apiKey();
    if (!key) throw new Error("SMITHSONIAN_API_KEY is not set");
    // The content endpoint keys off the search row id (`ld1-…`), not the
    // `edanmdm-…` form that appears elsewhere in the record.
    const url = `${BASE}/content/${encodeURIComponent(
      id,
    )}?api_key=${encodeURIComponent(key)}`;
    const res = await getJson<EdanContentResponse>(url);
    if (!res.response) throw new Error(`No Smithsonian record ${id}`);
    return toDetail(res.response);
  },
};
