/**
 * End-to-end smoke test against the live museum APIs.
 *
 * Museum APIs rot silently — endpoints get retired, hosts start challenging
 * bots, response shapes drift. Nothing in this repo would notice, because the
 * providers only run when a model calls them. This script exercises the full
 * search -> detail -> image path for every provider and exits non-zero when a
 * source that used to work stops working.
 *
 * Run locally with `npm run smoke`; CI runs it nightly.
 */
import { fetchImage } from "../lib/image.js";
import { getProvider } from "../providers/index.js";
import type { Provider, Source } from "../types.js";

/** A query known to return results, so a miss means the API changed. */
const QUERIES: Record<Source, string> = {
  met: "Rembrandt",
  artic: "Hokusai",
  cleveland: "Monet",
  harvard: "Van Gogh",
  rijksmuseum: "Rembrandt",
};

/**
 * Checks we already know fail, with the reason. These are reported but do not
 * fail the run — a nightly alert that is always red teaches everyone to ignore
 * it. They are still worth running: if one starts passing, we want to know.
 */
const KNOWN_BROKEN: Partial<Record<Source, { step: Step; reason: string }>> = {
  artic: {
    step: "image",
    reason: "images sit behind a Cloudflare bot challenge and 403 regardless of User-Agent",
  },
};

type Step = "search" | "detail" | "image";
type Status = "pass" | "fail" | "skip" | "known-broken";

interface StepResult {
  step: Step;
  status: Status;
  ms: number;
  detail: string;
}

interface SourceResult {
  source: Source;
  status: Status;
  steps: StepResult[];
}

/**
 * Time an operation, reporting elapsed ms on failure too — an instant DNS
 * blip and a 15s timeout are very different diagnoses and otherwise look
 * identical in the log.
 */
async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const started = Date.now();
  try {
    const value = await fn();
    return [value, Date.now() - started];
  } catch (err) {
    throw new TimedError(err, Date.now() - started);
  }
}

class TimedError extends Error {
  constructor(
    readonly cause: unknown,
    readonly ms: number,
  ) {
    super(describe(cause));
  }
}

/** Elapsed ms for a thrown error, when it came through `timed`. */
function elapsed(err: unknown): number {
  return err instanceof TimedError ? err.ms : 0;
}

const RETRIES = 2;

/**
 * Time an operation, retrying transient failures with a growing backoff.
 *
 * Without this a single dropped connection turns the nightly run red and files
 * an issue about a museum that was never down, which is the fastest way to
 * make the alert worthless.
 */
async function attempt<T>(fn: () => Promise<T>): Promise<[T, number]> {
  let last: unknown;
  for (let tries = 0; tries <= RETRIES; tries++) {
    try {
      return await timed(fn);
    } catch (err) {
      last = err;
      if (tries < RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * (tries + 1)));
      }
    }
  }
  throw last;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Run search -> detail -> image for one provider, collecting per-step results. */
async function checkProvider(provider: Provider): Promise<SourceResult> {
  const source = provider.id;
  const steps: StepResult[] = [];

  const record = (step: Step, status: Status, ms: number, detail: string) => {
    const known = KNOWN_BROKEN[source];
    // Downgrade an expected failure so it reports without breaking the build,
    // and flag the happy surprise when it starts working again.
    if (known?.step === step) {
      if (status === "fail") {
        steps.push({ step, status: "known-broken", ms, detail: `${detail} (expected: ${known.reason})` });
        return;
      }
      if (status === "pass") {
        steps.push({ step, status: "pass", ms, detail: `${detail} — NOTE: previously broken, now working` });
        return;
      }
    }
    steps.push({ step, status, ms, detail });
  };

  // --- search ---
  let results;
  try {
    const [found, ms] = await attempt(() => provider.search(QUERIES[source], 10));
    results = found;
    if (found.length === 0) {
      record("search", "fail", ms, `"${QUERIES[source]}" returned 0 results`);
      return { source, status: "fail", steps };
    }
    const bad = found.find((a) => !a.id || !a.title);
    if (bad) {
      record("search", "fail", ms, `result missing id or title: ${JSON.stringify(bad)}`);
      return { source, status: "fail", steps };
    }
    record("search", "pass", ms, `${found.length} results, first: ${found[0].title}`);
  } catch (err) {
    record("search", "fail", elapsed(err), describe(err));
    return { source, status: "fail", steps };
  }

  // --- detail ---
  try {
    const [detail, ms] = await attempt(() => provider.getArtwork(results[0].id));
    if (!detail.title) {
      record("detail", "fail", ms, `id ${results[0].id} returned no title`);
    } else {
      record("detail", "pass", ms, `${detail.title}${detail.artist ? ` — ${detail.artist}` : ""}`);
    }
  } catch (err) {
    record("detail", "fail", elapsed(err), `id ${results[0].id}: ${describe(err)}`);
  }

  // --- image ---
  // Not every record is illustrated, so take the first hit that offers a URL
  // rather than assuming the top result does.
  const withImage = results.find((a) => a.thumbnailUrl || a.imageUrl);
  if (!withImage) {
    record("image", "fail", 0, `no result out of ${results.length} had an image URL`);
  } else {
    const url = (withImage.thumbnailUrl || withImage.imageUrl) as string;
    try {
      const [image, ms] = await attempt(() => fetchImage(url));
      const bytes = Buffer.from(image.base64, "base64").length;
      // A challenge page or error placeholder still parses as a body, so
      // require enough bytes to plausibly be an actual image.
      if (bytes < 1024) {
        record("image", "fail", ms, `${url} returned only ${bytes} bytes`);
      } else {
        record("image", "pass", ms, `${(bytes / 1024).toFixed(0)}KB ${image.mimeType}`);
      }
    } catch (err) {
      record("image", "fail", elapsed(err), `${url}: ${describe(err)}`);
    }
  }

  const status: Status = steps.some((s) => s.status === "fail") ? "fail" : "pass";
  return { source, status, steps };
}

const ICON: Record<Status, string> = {
  pass: "✅",
  fail: "❌",
  skip: "⏭️",
  "known-broken": "⚠️",
};

async function main(): Promise<void> {
  const sources = Object.keys(QUERIES) as Source[];

  const results = await Promise.all(
    sources.map(async (source): Promise<SourceResult> => {
      const provider = getProvider(source);
      if (!provider) {
        return {
          source,
          status: "fail",
          steps: [{ step: "search", status: "fail", ms: 0, detail: "no provider registered" }],
        };
      }
      // Harvard needs a key. Missing credentials in CI is a configuration
      // choice, not an outage, so skip rather than fail.
      if (!provider.isAvailable()) {
        return {
          source,
          status: "skip",
          steps: [{ step: "search", status: "skip", ms: 0, detail: "unavailable (API key not configured)" }],
        };
      }
      return checkProvider(provider);
    }),
  );

  const lines: string[] = [];
  for (const result of results) {
    lines.push(`${ICON[result.status]} ${result.source}`);
    for (const step of result.steps) {
      lines.push(`   ${ICON[step.status]} ${step.step} (${step.ms}ms) — ${step.detail}`);
    }
  }

  const failed = results.filter((r) => r.status === "fail");
  const summary =
    `${results.filter((r) => r.status === "pass").length} passed, ` +
    `${failed.length} failed, ` +
    `${results.filter((r) => r.status === "skip").length} skipped`;

  const report = [...lines, "", summary].join("\n");
  console.log(report);

  // Hand the report to the workflow so it can paste it into an issue.
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(summaryPath, `## art-mcp smoke test\n\n\`\`\`\n${report}\n\`\`\`\n`);
  }
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    const { appendFileSync } = await import("node:fs");
    const delimiter = `EOF_${Date.now()}`;
    appendFileSync(outputPath, `report<<${delimiter}\n${report}\n${delimiter}\n`);
    appendFileSync(outputPath, `failed=${failed.map((f) => f.source).join(",")}\n`);
  }

  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`smoke test crashed: ${describe(err)}`);
  process.exit(1);
});
