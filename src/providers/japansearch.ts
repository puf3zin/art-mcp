import { getJson } from "../lib/http.js";
import type { Artwork, ArtworkDetail, Provider } from "../types.js";

// Japan Search is the National Diet Library's cross-sector aggregator: national
// museums, university archives, libraries and prefectural collections behind one
// index. Records are Japanese-language — there are no English titles to fall
// back on, so queries land best in Japanese ("北斎" rather than "Hokusai").
const BASE = "https://jpsearch.go.jp/api/item";
const SEARCH = `${BASE}/search/jps-cross`;

/**
 * `contentsRightsType` codes, mapped to something a reader recognises. Codes
 * outside this table are passed through as-is rather than dropped.
 */
const RIGHTS: Record<string, string> = {
  cc0: "CC0",
  pdm: "Public Domain Mark",
  ccby: "CC BY",
  ccbysa: "CC BY-SA",
  ccbynd: "CC BY-ND",
  ccbync: "CC BY-NC",
  ccbyncsa: "CC BY-NC-SA",
  ccbyncnd: "CC BY-NC-ND",
  nocr_cont: "No copyright — contractual restrictions",
  nocr_other: "No copyright — other restrictions",
  incr: "In copyright",
  incr_edu: "In copyright — educational use permitted",
  uneval: "Copyright not evaluated",
  undet: "Copyright undetermined",
};

/** Codes that mean the work itself is free of copyright. */
const PUBLIC_DOMAIN = new Set(["cc0", "pdm"]);

interface JpsCommon {
  title?: string;
  titleYomi?: string;
  contributor?: string[];
  temporal?: string[];
  thumbnailUrl?: string[];
  contentsUrl?: string[];
  /** A IIIF *manifest* URL, not an image — never hand this to fetchImage. */
  iiifUrl?: string;
  linkUrl?: string;
  provider?: string;
  providerUrl?: string;
  database?: string;
  contentsRightsType?: string;
  contentsType?: string;
  description?: string[];
  spatial?: string[];
  subject?: string[];
  type?: string[];
}

interface JpsItem {
  id: string;
  common?: JpsCommon;
}

interface JpsSearchResponse {
  list?: JpsItem[];
}

function first(list: string[] | undefined): string | undefined {
  return list?.find((v) => Boolean(v)) || undefined;
}

function joined(list: string[] | undefined): string | undefined {
  const values = (list ?? []).filter(Boolean);
  return values.length ? [...new Set(values)].join(", ") : undefined;
}

function licenseOf(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return RIGHTS[code] ?? code;
}

function toCompact(item: JpsItem): Artwork {
  const c = item.common ?? {};
  const title = c.title || "Untitled";
  const thumbnail = first(c.thumbnailUrl);
  return {
    source: "japansearch",
    id: item.id,
    title,
    // Records are Japanese-only. Carry the original explicitly so a client can
    // tell a native title from an English one rather than guessing from bytes.
    titleOriginal: title,
    language: "ja",
    artist: joined(c.contributor),
    date: first(c.temporal),
    imageUrl: first(c.contentsUrl) ?? thumbnail,
    thumbnailUrl: thumbnail,
    museumUrl: c.linkUrl || undefined,
  };
}

function toDetail(item: JpsItem): ArtworkDetail {
  const c = item.common ?? {};
  const code = c.contentsRightsType;
  return {
    ...toCompact(item),
    medium: joined(c.type),
    department: c.database || undefined,
    culture: joined(c.subject),
    originPlace: joined(c.spatial),
    creditLine: c.provider || undefined,
    isPublicDomain: code ? PUBLIC_DOMAIN.has(code) : undefined,
    license: licenseOf(code),
    description: first(c.description),
  };
}

export const japanSearchProvider: Provider = {
  id: "japansearch",
  name: "Japan Search (National Diet Library)",

  isAvailable() {
    return true;
  },

  async search(query, limit) {
    // f-contents=image keeps text-only archival records out of an image search.
    const url = `${SEARCH}?keyword=${encodeURIComponent(
      query,
    )}&size=${limit}&f-contents=image`;
    const res = await getJson<JpsSearchResponse>(url);
    return (res.list ?? []).map(toCompact);
  },

  async getArtwork(id) {
    const item = await getJson<JpsItem>(`${BASE}/${encodeURIComponent(id)}`);
    // The detail endpoint returns the record without echoing its own id.
    return toDetail({ ...item, id: item.id ?? id });
  },
};
