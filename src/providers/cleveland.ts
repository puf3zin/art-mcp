import { getJson } from "../lib/http.js";
import type { Artwork, ArtworkDetail, Provider } from "../types.js";

const BASE = "https://openaccess-api.clevelandart.org/api/artworks";

interface ClevelandImage {
  url: string;
}

interface ClevelandArtwork {
  id: number;
  accession_number: string;
  title: string;
  creation_date: string;
  creators?: { description: string }[];
  images?: {
    web?: ClevelandImage;
    print?: ClevelandImage;
    full?: ClevelandImage;
  };
  url?: string;
  technique?: string;
  measurements?: string;
  department?: string;
  culture?: string[];
  creditline?: string;
  share_license_status?: string;
  description?: string;
}

interface ClevelandListResponse {
  data: ClevelandArtwork[];
}

interface ClevelandDetailResponse {
  data: ClevelandArtwork;
}

function toCompact(a: ClevelandArtwork): Artwork {
  const artist = a.creators?.[0]?.description;
  return {
    source: "cleveland",
    id: String(a.id),
    title: a.title || "Untitled",
    artist: artist || undefined,
    date: a.creation_date || undefined,
    imageUrl: a.images?.web?.url ?? a.images?.print?.url ?? a.images?.full?.url,
    thumbnailUrl: a.images?.web?.url,
    museumUrl: a.url || undefined,
  };
}

function toDetail(a: ClevelandArtwork): ArtworkDetail {
  return {
    ...toCompact(a),
    medium: a.technique || undefined,
    dimensions: a.measurements || undefined,
    department: a.department || undefined,
    culture: a.culture?.join(", ") || undefined,
    creditLine: a.creditline || undefined,
    isPublicDomain: a.share_license_status === "CC0",
    description: a.description || undefined,
  };
}

export const clevelandProvider: Provider = {
  id: "cleveland",
  name: "Cleveland Museum of Art",

  isAvailable() {
    return true;
  },

  async search(query, limit) {
    const url = `${BASE}?q=${encodeURIComponent(
      query,
    )}&has_image=1&limit=${limit}`;
    const res = await getJson<ClevelandListResponse>(url);
    return (res.data ?? []).map(toCompact);
  },

  async getArtwork(id) {
    const res = await getJson<ClevelandDetailResponse>(
      `${BASE}/${encodeURIComponent(id)}`,
    );
    return toDetail(res.data);
  },
};
