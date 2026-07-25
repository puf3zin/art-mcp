/** Identifiers for each supported museum data source. */
export type Source = "met" | "artic" | "cleveland" | "harvard" | "rijksmuseum";

export const SOURCES: Source[] = [
  "met",
  "artic",
  "cleveland",
  "harvard",
  "rijksmuseum",
];

/** Compact record returned from a search. */
export interface Artwork {
  source: Source;
  /** Provider-native identifier, always stringified. */
  id: string;
  title: string;
  artist?: string;
  date?: string;
  /** Smaller image suitable for previews. */
  thumbnailUrl?: string;
  /** Best full-size image URL, when available. */
  imageUrl?: string;
  /** Page for this object on the museum's own website. */
  museumUrl?: string;
}

/** Full record returned when fetching a single artwork. */
export interface ArtworkDetail extends Artwork {
  medium?: string;
  dimensions?: string;
  department?: string;
  culture?: string;
  creditLine?: string;
  isPublicDomain?: boolean;
  description?: string;
}

/** Common interface every museum provider implements. */
export interface Provider {
  readonly id: Source;
  readonly name: string;
  /** Whether the provider can currently be queried (e.g. required key present). */
  isAvailable(): boolean;
  search(query: string, limit: number): Promise<Artwork[]>;
  getArtwork(id: string): Promise<ArtworkDetail>;
}
