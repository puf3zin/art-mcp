import { getJson } from "../lib/http.js";
import type { Artwork, ArtworkDetail, Provider } from "../types.js";

// Museum of New Zealand Te Papa Tongarewa. The reason this source is here is
// Taonga Māori and Pacific Cultures — the largest such holdings behind any open
// collections API.
//
// Two things to know about rights. Metadata is CC BY 4.0, but images are mostly
// "All Rights Reserved": Te Papa applies cultural protocols to taonga Māori, and
// `allowsDownload: false` is the norm rather than the exception. That flag is a
// reuse signal, not an access control — the image still fetches — so the rights
// statement is carried through to `license` and must not be read as permission.
const BASE = "https://data.tepapa.govt.nz/collection";
const ITEM_PAGE = "https://collections.tepapa.govt.nz/object";

function apiKey(): string | undefined {
  return process.env.TEPAPA_API_KEY?.trim() || undefined;
}

function headers(key: string): Record<string, string> {
  return { "x-api-key": key };
}

// --- Shapes (only the parts we read) -----------------------------------------

interface TitledRef {
  title?: string;
  prefLabel?: string;
}

interface TepapaProduction {
  /** A single agent, not a list — unlike most fields on this API. */
  contributor?: TitledRef;
  createdDate?: string;
  role?: string;
  spatial?: TitledRef;
}

interface TepapaMeasurement {
  /** Pre-formatted, e.g. "Overall: 1460mm (width), 40mm (height)". */
  title?: string;
}

interface TepapaImage {
  /** `/full` answers 500 across the collection; only these two resolve. */
  previewUrl?: string;
  thumbnailUrl?: string;
  rights?: { title?: string; allowsDownload?: boolean };
}

interface TepapaObject {
  id?: string | number;
  pid?: string;
  title?: string;
  identifier?: string;
  production?: TepapaProduction[];
  isTypeOf?: TitledRef[];
  isMadeOf?: TitledRef[];
  isMadeOfSummary?: string;
  productionUsedTechnique?: TitledRef[];
  observedDimension?: TepapaMeasurement[];
  collection?: string;
  collectionLabel?: string;
  creditLine?: string;
  description?: string;
  caption?: string;
  hasRepresentation?: TepapaImage[];
}

interface TepapaSearchResponse {
  results?: TepapaObject[];
}

// --- Helpers -----------------------------------------------------------------

function label(ref: TitledRef | undefined): string | undefined {
  return ref?.title || ref?.prefLabel || undefined;
}

function labels(refs: TitledRef[] | undefined): string | undefined {
  const values = (refs ?? [])
    .map(label)
    .filter((v): v is string => Boolean(v));
  return values.length ? [...new Set(values)].join(", ") : undefined;
}

/** Descriptions come back as HTML fragments. */
function plain(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return (
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ")
      .trim() || undefined
  );
}

function idOf(o: TepapaObject): string {
  return String(o.id ?? o.pid ?? "");
}

function artistOf(o: TepapaObject): string | undefined {
  const names = (o.production ?? [])
    .map((p) => label(p.contributor))
    .filter((n): n is string => Boolean(n));
  // A great deal of taonga is unattributed and catalogued as "Unknown"; an
  // absent artist reads better than an artist literally named Unknown.
  const named = names.filter((n) => n.toLowerCase() !== "unknown");
  return named.length ? [...new Set(named)].join(", ") : undefined;
}

function dateOf(o: TepapaObject): string | undefined {
  return (o.production ?? []).map((p) => p.createdDate).find(Boolean) || undefined;
}

function placeOf(o: TepapaObject): string | undefined {
  return (o.production ?? []).map((p) => label(p.spatial)).find(Boolean) || undefined;
}

/**
 * Prefer a representation that is cleared for reuse; fall back to the first
 * with an image so a restricted work is still viewable.
 */
function representation(o: TepapaObject): TepapaImage | undefined {
  const withImage = (o.hasRepresentation ?? []).filter(
    (r) => r.previewUrl || r.thumbnailUrl,
  );
  return withImage.find((r) => r.rights?.allowsDownload) ?? withImage[0];
}

function toCompact(o: TepapaObject): Artwork {
  const id = idOf(o);
  const image = representation(o);
  return {
    source: "tepapa",
    id,
    // Titles are frequently te reo Māori ("Korowai hihimā (cloak)"); the API
    // publishes one title per object and does not tag its language, so no
    // language claim is made here.
    title: o.title || labels(o.isTypeOf) || "Untitled",
    artist: artistOf(o),
    date: dateOf(o),
    imageUrl: image?.previewUrl ?? image?.thumbnailUrl,
    thumbnailUrl: image?.thumbnailUrl ?? image?.previewUrl,
    museumUrl: id ? `${ITEM_PAGE}/${encodeURIComponent(id)}` : undefined,
  };
}

function toDetail(o: TepapaObject): ArtworkDetail {
  const rights = representation(o)?.rights;
  return {
    ...toCompact(o),
    medium:
      o.isMadeOfSummary || labels(o.isMadeOf) || labels(o.productionUsedTechnique),
    dimensions: o.observedDimension?.map((d) => d.title).filter(Boolean)[0],
    department: o.collectionLabel || o.collection,
    culture: labels(o.isTypeOf),
    originPlace: placeOf(o),
    creditLine: o.creditLine || o.identifier || undefined,
    // "All Rights Reserved" is the common case here, including for images this
    // server can still fetch. Never infer reuse rights from a successful fetch.
    isPublicDomain: rights?.title
      ? /no known copyright|public domain/i.test(rights.title)
      : undefined,
    license: rights?.title || undefined,
    description: plain(o.description) ?? plain(o.caption),
  };
}

export const tepapaProvider: Provider = {
  id: "tepapa",
  name: "Museum of New Zealand Te Papa Tongarewa",

  isAvailable() {
    return apiKey() !== undefined;
  },

  async search(query, limit) {
    const key = apiKey();
    if (!key) throw new Error("TEPAPA_API_KEY is not set");
    // The index mixes collection objects with publications, topics and people,
    // so a bare keyword returns books *about* korowai above any actual cloak.
    const q = `(${query}) AND type:Object AND _exists_:hasRepresentation`;
    const url = `${BASE}/search?q=${encodeURIComponent(q)}&size=${limit}`;
    const res = await getJson<TepapaSearchResponse>(url, { headers: headers(key) });
    return (res.results ?? []).map(toCompact);
  },

  async getArtwork(id) {
    const key = apiKey();
    if (!key) throw new Error("TEPAPA_API_KEY is not set");
    const res = await getJson<TepapaObject>(
      `${BASE}/object/${encodeURIComponent(id)}`,
      { headers: headers(key) },
    );
    return toDetail({ ...res, id: res.id ?? id });
  },
};
