import { getBytes } from "./http.js";

export interface FetchedImage {
  base64: string;
  mimeType: string;
}

/** Guess a reasonable image MIME type from the URL extension. */
function mimeFromUrl(url: string): string {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".tif") || clean.endsWith(".tiff")) return "image/tiff";
  return "image/jpeg";
}

/**
 * Download an image and return it base64-encoded, ready for an MCP image
 * content block.
 */
export async function fetchImage(url: string): Promise<FetchedImage> {
  const { bytes, contentType } = await getBytes(url);
  const mimeType =
    contentType && contentType.startsWith("image/")
      ? contentType.split(";")[0].trim()
      : mimeFromUrl(url);
  return { base64: Buffer.from(bytes).toString("base64"), mimeType };
}
