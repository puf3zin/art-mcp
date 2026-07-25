import { getJson } from "../lib/http.js";
import type { Artwork, ArtworkDetail, Provider } from "../types.js";

const BASE = "https://collectionapi.metmuseum.org/public/collection/v1";

interface MetSearchResponse {
  total: number;
  objectIDs: number[] | null;
}

interface MetObject {
  objectID: number;
  title: string;
  artistDisplayName: string;
  objectDate: string;
  primaryImage: string;
  primaryImageSmall: string;
  objectURL: string;
  medium: string;
  dimensions: string;
  department: string;
  culture: string;
  creditLine: string;
  isPublicDomain: boolean;
}

function toDetail(obj: MetObject): ArtworkDetail {
  return {
    source: "met",
    id: String(obj.objectID),
    title: obj.title || "Untitled",
    artist: obj.artistDisplayName || undefined,
    date: obj.objectDate || undefined,
    thumbnailUrl: obj.primaryImageSmall || undefined,
    imageUrl: obj.primaryImage || undefined,
    museumUrl: obj.objectURL || undefined,
    medium: obj.medium || undefined,
    dimensions: obj.dimensions || undefined,
    department: obj.department || undefined,
    culture: obj.culture || undefined,
    creditLine: obj.creditLine || undefined,
    isPublicDomain: obj.isPublicDomain,
  };
}

async function fetchObject(id: string | number): Promise<MetObject> {
  return getJson<MetObject>(`${BASE}/objects/${id}`);
}

export const metProvider: Provider = {
  id: "met",
  name: "The Metropolitan Museum of Art",

  isAvailable() {
    return true;
  },

  async search(query, limit) {
    const url = `${BASE}/search?hasImages=true&q=${encodeURIComponent(query)}`;
    const res = await getJson<MetSearchResponse>(url);
    const ids = (res.objectIDs ?? []).slice(0, limit);
    // The search endpoint returns only IDs; hydrate each in parallel.
    const objects = await Promise.allSettled(ids.map((id) => fetchObject(id)));
    const results: Artwork[] = [];
    for (const r of objects) {
      if (r.status === "fulfilled") {
        const d = toDetail(r.value);
        const { medium, dimensions, department, culture, creditLine, isPublicDomain, ...compact } =
          d;
        results.push(compact);
      }
    }
    return results;
  },

  async getArtwork(id) {
    return toDetail(await fetchObject(id));
  },
};
