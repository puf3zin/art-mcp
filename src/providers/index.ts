import type { Provider, Source } from "../types.js";
import { articProvider } from "./artic.js";
import { clevelandProvider } from "./cleveland.js";
import { harvardProvider } from "./harvard.js";
import { metProvider } from "./met.js";
import { rijksmuseumProvider } from "./rijksmuseum.js";

/** All known providers, in default fan-out order. */
export const providers: Provider[] = [
  metProvider,
  articProvider,
  clevelandProvider,
  harvardProvider,
  rijksmuseumProvider,
];

const byId = new Map<Source, Provider>(providers.map((p) => [p.id, p]));

export function getProvider(source: Source): Provider | undefined {
  return byId.get(source);
}

/** Providers that can currently be queried (required keys present). */
export function availableProviders(): Provider[] {
  return providers.filter((p) => p.isAvailable());
}
