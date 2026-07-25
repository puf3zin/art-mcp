import { getJson } from "../lib/http.js";
import type { Artwork, ArtworkDetail, Provider } from "../types.js";

const BASE = "https://api.artic.edu/api/v1";
const IIIF = "https://www.artic.edu/iiif/2";

function imageUrls(imageId: string | null): {
  imageUrl?: string;
  thumbnailUrl?: string;
} {
  if (!imageId) return {};
  return {
    imageUrl: `${IIIF}/${imageId}/full/843,/0/default.jpg`,
    thumbnailUrl: `${IIIF}/${imageId}/full/200,/0/default.jpg`,
  };
}

interface ArticArtwork {
  id: number;
  title: string;
  artist_display: string;
  date_display: string;
  image_id: string | null;
  medium_display?: string;
  dimensions?: string;
  department_title?: string;
  place_of_origin?: string;
  credit_line?: string;
  is_public_domain?: boolean;
  is_zoomable?: boolean;
}

interface ArticSearchResponse {
  data: ArticArtwork[];
}

interface ArticDetailResponse {
  data: ArticArtwork;
}

function toCompact(a: ArticArtwork): Artwork {
  return {
    source: "artic",
    id: String(a.id),
    title: a.title || "Untitled",
    artist: a.artist_display || undefined,
    date: a.date_display || undefined,
    museumUrl: `https://www.artic.edu/artworks/${a.id}`,
    ...imageUrls(a.image_id),
  };
}

function toDetail(a: ArticArtwork): ArtworkDetail {
  return {
    ...toCompact(a),
    medium: a.medium_display || undefined,
    dimensions: a.dimensions || undefined,
    department: a.department_title || undefined,
    culture: a.place_of_origin || undefined,
    creditLine: a.credit_line || undefined,
    isPublicDomain: a.is_public_domain,
  };
}

export const articProvider: Provider = {
  id: "artic",
  name: "Art Institute of Chicago",

  isAvailable() {
    return true;
  },

  async search(query, limit) {
    const fields = "id,title,artist_display,date_display,image_id";
    const url = `${BASE}/artworks/search?q=${encodeURIComponent(
      query,
    )}&limit=${limit}&fields=${fields}`;
    const res = await getJson<ArticSearchResponse>(url);
    return (res.data ?? []).map(toCompact);
  },

  async getArtwork(id) {
    const fields =
      "id,title,artist_display,date_display,image_id,medium_display,dimensions,department_title,place_of_origin,credit_line,is_public_domain";
    const url = `${BASE}/artworks/${encodeURIComponent(id)}?fields=${fields}`;
    const res = await getJson<ArticDetailResponse>(url);
    return toDetail(res.data);
  },
};
