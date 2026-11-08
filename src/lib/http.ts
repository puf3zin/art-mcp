import { VERSION } from "../version.js";

const DEFAULT_TIMEOUT_MS = 15_000;

// Sent on every museum request, so it should say which version is calling.
const USER_AGENT = `art-mcp/${VERSION} (+https://github.com/puf3zin/art-mcp; MCP server)`;

/**
 * The Art Institute of Chicago asks API clients to identify themselves in an
 * `AIC-User-Agent` header (https://api.artic.edu/docs/#user-agent). Without it,
 * Cloudflare serves a bot challenge (403, `cf-mitigated: challenge`) on both
 * the API and the IIIF image host, which share the artic.edu domain.
 */
function hostHeaders(url: string): Record<string, string> {
  try {
    const host = new URL(url).hostname;
    if (host === "artic.edu" || host.endsWith(".artic.edu")) {
      return { "AIC-User-Agent": USER_AGENT };
    }
  } catch {
    // An unparseable URL fails in fetch with a clearer message.
  }
  return {};
}

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

/**
 * Fetch with a timeout that covers the whole exchange, body included. `read`
 * consumes the response while the timer is still running; the timer used to
 * be cleared as soon as headers arrived, so a stalled body hung forever.
 */
async function request<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number | undefined,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  timeoutMs ??= DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        ...hostHeaders(url),
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
    return await read(res);
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

export interface JsonOptions {
  timeoutMs?: number;
  /** Extra request headers, e.g. an `x-api-key` or a non-default `Accept`. */
  headers?: Record<string, string>;
}

/** Fetch a URL and parse the body as JSON. */
export async function getJson<T = unknown>(
  url: string,
  options?: number | JsonOptions,
): Promise<T> {
  // The second argument used to be a bare timeout; keep that call shape working.
  const { timeoutMs, headers }: JsonOptions =
    typeof options === "number" ? { timeoutMs: options } : (options ?? {});
  return request(
    url,
    { headers: { Accept: "application/json", ...headers } },
    timeoutMs,
    async (res) => (await res.json()) as T,
  );
}

/** POST a JSON body and parse the response as JSON. */
export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  options: JsonOptions = {},
): Promise<T> {
  return request(
    url,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...options.headers,
      },
    },
    options.timeoutMs,
    async (res) => (await res.json()) as T,
  );
}

/** Fetch a URL and return the raw bytes plus content type. */
export async function getBytes(
  url: string,
  timeoutMs?: number,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  return request(url, {}, timeoutMs, async (res) => ({
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get("content-type"),
  }));
}
