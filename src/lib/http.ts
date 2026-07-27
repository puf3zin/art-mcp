const DEFAULT_TIMEOUT_MS = 15_000;

const USER_AGENT =
  "art-mcp/0.2 (+https://github.com/puf3zin/art-mcp; MCP server)";

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
  const res = await request(
    url,
    { headers: { Accept: "application/json", ...headers } },
    timeoutMs,
  );
  return (await res.json()) as T;
}

/** POST a JSON body and parse the response as JSON. */
export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  options: JsonOptions = {},
): Promise<T> {
  const res = await request(
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
  );
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
