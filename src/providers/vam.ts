import { FULL_WIDTH, THUMB_WIDTH, iiifImageUrl } from "../lib/iiif.js";
import { getJson } from "../lib/http.js";
import type { Artwork, ArtworkDetail, Provider } from "../types.js";

const BASE = "https://api.vam.ac.uk/v2";
const IIIF = "https://framemark.vam.ac.uk/collections";
const ITEM_PAGE = "https://collections.vam.ac.uk/item";

// The V&A publishes metadata under terms that allow personal and educational
// use; commercial reuse needs a licence. There is no per-object rights field to
// read, so every record carries the same statement rather than a guess.
const LICENSE = "V&A API Terms — personal and educational use";

// --- Search shapes (only the parts we read) ----------------------------------

interface VamSearchRecord {
  systemNumber: string;
  objectType?: string;
  _primaryTitle?: string;
  _primaryMaker?: { name?: string };
  _primaryDate?: string;
  _primaryPlace?: string;
  _images?: {
    _primary_thumbnail?: string;
    _iiif_image_base_url?: string;
  };
}

interface VamSearchResponse {
  records?: VamSearchRecord[];
}

// --- Detail shapes -----------------------------------------------------------

interface VamText {
  text?: string;
}

interface VamDimension {
  dimension?: string;
  value?: string;
  unit?: string;
}

interface VamRecord {
  systemNumber: string;
  titles?: { title?: string; type?: string }[];
  objectType?: string;
  artistMakerPerson?: { name?: VamText; association?: VamText }[];
  placesOfOrigin?: { place?: VamText }[];
  productionDates?: { date?: { text?: string } }[];
  materialsAndTechniques?: string;
  dimensions?: VamDimension[];
  collectionCode?: VamText;
  creditLine?: string;
  summaryDescription?: string;
  physicalDescription?: string;
  objectHistory?: string;
  images?: string[];
}

interface VamDetailResponse {
  record: VamRecord;
}

// --- Helpers -----------------------------------------------------------------

function imagesFrom(imageId: string | undefined) {
  if (!imageId) return {};
  const base = `${IIIF}/${imageId}/`;
  return {
    imageUrl: iiifImageUrl(base, FULL_WIDTH),
    thumbnailUrl: iiifImageUrl(base, THUMB_WIDTH),
  };
}

function itemPage(systemNumber: string): string {
  return `${ITEM_PAGE}/${encodeURIComponent(systemNumber)}/`;
}

/** Flatten the structured dimension list into "Height 25.4 cm × Width 36.7 cm". */
function dimensionsOf(record: VamRecord): string | undefined {
  const parts = (record.dimensions ?? [])
    .map((d) => {
      if (!d.dimension || !d.value) return undefined;
      return `${d.dimension} ${d.value}${d.unit ? ` ${d.unit}` : ""}`;
    })
    .filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(" × ") : undefined;
}

function titleOf(record: VamRecord): string {
  // Prefer a title the artist assigned over a curatorial or series title.
  const titles = record.titles ?? [];
  const assigned = titles.find((t) => t.type === "assigned by artist");
  return (assigned ?? titles[0])?.title || record.objectType || "Untitled";
}

function artistOf(record: VamRecord): string | undefined {
  const names = (record.artistMakerPerson ?? [])
    .map((p) => p.name?.text)
    .filter((n): n is string => Boolean(n));
  return names.length ? [...new Set(names)].join(", ") : undefined;
}

function toCompact(r: VamSearchRecord): Artwork {
  // Search already hands back a thumbnail, but it is capped at 100px; rebuild
  // both sizes off the IIIF base so previews match the other sources.
  const base = r._images?._iiif_image_base_url;
  const images = base
    ? {
        imageUrl: iiifImageUrl(base, FULL_WIDTH),
        thumbnailUrl: iiifImageUrl(base, THUMB_WIDTH),
      }
    : { thumbnailUrl: r._images?._primary_thumbnail };

  return {
    source: "vam",
    id: r.systemNumber,
    // Much of the collection is design and craft with no assigned title; the
    // object type ("Wine glass") says more than "Untitled" does.
    title: r._primaryTitle || r.objectType || "Untitled",
    artist: r._primaryMaker?.name || undefined,
    date: r._primaryDate || undefined,
    ...images,
    museumUrl: itemPage(r.systemNumber),
  };
}

function toDetail(record: VamRecord): ArtworkDetail {
  const place = record.placesOfOrigin?.[0]?.place?.text;
  return {
    source: "vam",
    id: record.systemNumber,
    title: titleOf(record),
    artist: artistOf(record),
    date: record.productionDates?.[0]?.date?.text || undefined,
    // The detail record carries image *ids*, not URLs — build them ourselves.
    ...imagesFrom(record.images?.[0]),
    museumUrl: itemPage(record.systemNumber),
    medium: record.materialsAndTechniques || undefined,
    dimensions: dimensionsOf(record),
    department: record.collectionCode?.text || undefined,
    originPlace: place || undefined,
    culture: place || undefined,
    creditLine: record.creditLine || undefined,
    license: LICENSE,
    description:
      record.summaryDescription ||
      record.physicalDescription ||
      record.objectHistory ||
      undefined,
  };
}

export const vamProvider: Provider = {
  id: "vam",
  name: "Victoria and Albert Museum",

  isAvailable() {
    return true;
  },

  async search(query, limit) {
    const url = `${BASE}/objects/search?q=${encodeURIComponent(
      query,
    )}&images_exist=true&page_size=${limit}`;
    const res = await getJson<VamSearchResponse>(url);
    return (res.records ?? []).map(toCompact);
  },

  async getArtwork(id) {
    const res = await getJson<VamDetailResponse>(
      `${BASE}/museumobject/${encodeURIComponent(id)}`,
    );
    return toDetail(res.record);
  },
};
