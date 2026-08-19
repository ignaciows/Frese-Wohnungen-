/**
 * The adapter registry.
 *
 * There is exactly one adapter, because there is exactly one portal that lets
 * us read its result list. ImmoScout24 answers 401 to an automated request and
 * Immowelt answers 403 on every exposé behind its list — so they do not get an
 * adapter, they get a Suchauftrag that mails us the hits (docs/QUELLEN.md).
 *
 * This stays a registry rather than a direct import: a source's
 * `discoveryAdapter` column holds a key, and an unknown key has to mean "no
 * automatic discovery" instead of a crash — that is the normal state for the
 * two e-mail sources.
 */

import type { DiscoveryAdapter } from './types';
import { kleinanzeigenAdapter } from './adapters/kleinanzeigen';
import { immoweltAdapter } from './adapters/immowelt';

export const ADAPTERS: DiscoveryAdapter[] = [kleinanzeigenAdapter, immoweltAdapter];

const BY_KEY = new Map(ADAPTERS.map((a) => [a.key, a]));

export function getAdapter(key: string | null | undefined): DiscoveryAdapter | null {
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

/**
 * Which required config keys are still empty. The settings screen uses this to
 * say "this source will not produce anything until you fill in X" rather than
 * letting an admin start a sweep that can only ever return nothing.
 */
export function missingConfig(
  adapterKey: string | null | undefined,
  config: Record<string, unknown> | null | undefined,
): string[] {
  const adapter = getAdapter(adapterKey);
  if (!adapter) return [];
  const cfg = config ?? {};
  return adapter.configKeys
    .filter((k) => k.required)
    .filter((k) => {
      const value = cfg[k.key];
      return value == null || (typeof value === 'string' && !value.trim());
    })
    .map((k) => k.key);
}

export { kleinanzeigenAdapter };
export * from './types';
