/** Identifiers for each supported museum data source. */
export const SOURCES = [
  "met",
  "artic",
  "cleveland",
  "harvard",
  "rijksmuseum",
  "vam",
  "smithsonian",
  "japansearch",
  "tepapa",
  "wikidata",
] as const;

export type Source = (typeof SOURCES)[number];

/** Compact record returned from a search. */
export interface Artwork {
  source: Source;
  /** Provider-native identifier, always stringified. */
  id: string;
  title: string;
  /**
   * Title in the object's own language and script, when the source publishes
   * one. Sources outside the Anglophone world often have no English title at
   * all, in which case `title` carries the original and this repeats it.
   */
  titleOriginal?: string;
  /** BCP-47 tag for `title`, e.g. "ja". Omitted when the source is English. */
  language?: string;
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
  /** Where the object was made, when the source distinguishes it from culture. */
  originPlace?: string;
  creditLine?: string;
  isPublicDomain?: boolean;
  /**
   * Rights in the source's own terms, e.g. "CC0", "CC BY-NC-SA". Many
   * collections publish licences that `isPublicDomain` cannot express.
   */
  license?: string;
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
