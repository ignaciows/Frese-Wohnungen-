/**
 * The adapter registry. A source's `discoveryAdapter` column holds one of
 * these keys; an unknown key simply means the source has no automatic
 * discovery, which is a normal state, not an error.
 */

import type { DiscoveryAdapter } from './types';
import { kleinanzeigenAdapter } from './adapters/kleinanzeigen';
import { wgGesuchtAdapter } from './adapters/wggesucht';
import { telegramAdapter } from './adapters/telegram';
import { GENERIC_ADAPTERS } from './adapters/generic';

export const ADAPTERS: DiscoveryAdapter[] = [
  kleinanzeigenAdapter,
  wgGesuchtAdapter,
  telegramAdapter,
  ...GENERIC_ADAPTERS,
];

const BY_KEY = new Map(ADAPTERS.map((a) => [a.key, a]));

export function getAdapter(key: string | null | undefined): DiscoveryAdapter | null {
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

export function adapterChoices(): Array<{ key: string; label: string; description: string }> {
  return ADAPTERS.map((a) => ({ key: a.key, label: a.label, description: a.description }));
}

/**
 * Which required config keys are still empty. The settings screen uses this to
 * say "this source will not produce anything until you fill in X" rather than
 * letting an admin enable a sweep that can only ever return nothing.
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

export { kleinanzeigenAdapter, wgGesuchtAdapter, telegramAdapter };
export * from './types';
