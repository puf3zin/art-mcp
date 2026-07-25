import { getJson } from "../lib/http.js";
import type { Artwork, ArtworkDetail, Provider } from "../types.js";

const BASE = "https://api.harvardartmuseums.org";

function apiKey(): string | undefined {
  return process.env.HARVARD_API_KEY?.trim() || undefined;
}

interface HarvardObject {
  objectid: number;
  title: string;
  people?: { name: string; role: string }[];
  dated?: string;
  primaryimageurl?: string;
  url?: string;
  medium?: string;
  dimensions?: string;
  department?: string;
  culture?: string;
  creditline?: string;
  description?: string;
  verificationlevel?: number;
}

interface HarvardSearchResponse {
  records: HarvardObject[];
}

function toCompact(o: HarvardObject): Artwork {
  const artist = o.people?.find((p) => p.role === "Artist")?.name ?? o.people?.[0]?.name;
  return {
    source: "harvard",
    id: String(o.objectid),
    title: o.title || "Untitled",
    artist: artist || undefined,
    date: o.dated || undefined,
    imageUrl: o.primaryimageurl || undefined,
    thumbnailUrl: o.primaryimageurl || undefined,
    museumUrl: o.url || undefined,
  };
}

function toDetail(o: HarvardObject): ArtworkDetail {
  return {
    ...toCompact(o),
    medium: o.medium || undefined,
    dimensions: o.dimensions || undefined,
    department: o.department || undefined,
    culture: o.culture || undefined,
    creditLine: o.creditline || undefined,
    description: o.description || undefined,
  };
}

export const harvardProvider: Provider = {
  id: "harvard",
  name: "Harvard Art Museums",

  isAvailable() {
    return apiKey() !== undefined;
  },

  async search(query, limit) {
    const key = apiKey();
    if (!key) throw new Error("HARVARD_API_KEY is not set");
    const url = `${BASE}/object?apikey=${key}&q=${encodeURIComponent(
      query,
    )}&size=${limit}&hasimage=1&sort=rank`;
    const res = await getJson<HarvardSearchResponse>(url);
    return (res.records ?? []).map(toCompact);
  },

  async getArtwork(id) {
    const key = apiKey();
    if (!key) throw new Error("HARVARD_API_KEY is not set");
    const url = `${BASE}/object/${encodeURIComponent(id)}?apikey=${key}`;
    const res = await getJson<HarvardObject>(url);
    return toDetail(res);
  },
};
