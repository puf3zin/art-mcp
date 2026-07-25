const DEFAULT_TIMEOUT_MS = 15_000;

const USER_AGENT = "art-mcp/0.1 (+https://github.com/; MCP server)";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

async function request(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new HttpError(
        `Request failed with status ${res.status} ${res.statusText}`,
        res.status,
        url,
      );
    }
    return res;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new HttpError(`Request timed out after ${timeoutMs}ms`, undefined, url);
    }
    throw new HttpError(
      `Request failed: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      url,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a URL and parse the body as JSON. */
export async function getJson<T = unknown>(
  url: string,
  timeoutMs?: number,
): Promise<T> {
  const res = await request(url, { headers: { Accept: "application/json" } }, timeoutMs);
  return (await res.json()) as T;
}

/** Fetch a URL and return the raw bytes plus content type. */
export async function getBytes(
  url: string,
  timeoutMs?: number,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const res = await request(url, {}, timeoutMs);
  const buf = new Uint8Array(await res.arrayBuffer());
  return { bytes: buf, contentType: res.headers.get("content-type") };
}
