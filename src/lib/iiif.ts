/**
 * Width to request for a full-size image. Originals from IIIF servers routinely
 * run to several megabytes, which is more than a model needs to look at a work.
 */
export const FULL_WIDTH = 843;

/** Width to request for a preview thumbnail. */
export const THUMB_WIDTH = 200;

/** Rewrite a IIIF `full/max` (or `full/full`) URL to a bounded width. */
export function iiifAtWidth(
  url: string | undefined,
  width: number,
): string | undefined {
  if (!url) return undefined;
  return url.replace(/\/full\/(max|full)\//, `/full/${width},/`);
}

/**
 * Build an image URL from a IIIF Image API base, e.g.
 * `https://framemark.vam.ac.uk/collections/2016JR4703/`.
 */
export function iiifImageUrl(base: string, width: number): string {
  return `${base.replace(/\/$/, "")}/full/${width},/0/default.jpg`;
}
