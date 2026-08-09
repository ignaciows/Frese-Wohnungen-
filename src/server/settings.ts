/**
 * Admin-editable settings, stored in AppSetting as JSON blobs.
 *
 * Anything a manager might reasonably want to tune lives here rather than in
 * code, so behaviour can change without a deployment. Every getter falls back
 * to a documented default, so a missing or malformed row can never break the
 * app.
 */

import { prisma } from '@/lib/prisma';
import { DEFAULT_SHARING_SETTINGS, type SharingSettings } from '@/domain/sharing';
import {
  DEFAULT_BRIDGING,
  DEFAULT_FRESHNESS,
  type BridgingSettings,
  type FreshnessSettings,
} from '@/domain/timing';
import { DEFAULT_LIVENESS, type LivenessPolicy } from '@/domain/liveness';

export const SETTING_KEYS = {
  sharing: 'sharing',
  sourceRecheck: 'sourceRecheck',
  systemTransfer: 'systemTransfer',
  freshness: 'freshness',
  bridging: 'bridging',
  liveness: 'liveness',
} as const;

export interface SourceRecheckSettings {
  /** A source counts as "due again" this many days after it was last checked. */
  recheckAfterDays: number;
  /** Highlight sources that were never checked in this search run. */
  highlightNeverChecked: boolean;
}

export const DEFAULT_SOURCE_RECHECK: SourceRecheckSettings = {
  recheckAfterDays: 3,
  highlightNeverChecked: true,
};

export interface SystemTransferSettings {
  /** Labels used by the three-field copy panel, in order. */
  objectLabel: string;
  linkLabel: string;
  locationLabel: string;
}

export const DEFAULT_SYSTEM_TRANSFER: SystemTransferSettings = {
  objectLabel: 'Wohnung/Objekt',
  linkLabel: 'Link',
  locationLabel: 'Ort',
};

async function readSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    if (!row) return fallback;
    // Merge so a setting added later still gets its default.
    return { ...fallback, ...(row.valueJson as object) } as T;
  } catch {
    return fallback;
  }
}

export function getSharingSettings(): Promise<SharingSettings> {
  return readSetting(SETTING_KEYS.sharing, DEFAULT_SHARING_SETTINGS);
}

export function getSourceRecheckSettings(): Promise<SourceRecheckSettings> {
  return readSetting(SETTING_KEYS.sourceRecheck, DEFAULT_SOURCE_RECHECK);
}

export function getSystemTransferSettings(): Promise<SystemTransferSettings> {
  return readSetting(SETTING_KEYS.systemTransfer, DEFAULT_SYSTEM_TRANSFER);
}

export function getFreshnessSettings(): Promise<FreshnessSettings> {
  return readSetting(SETTING_KEYS.freshness, DEFAULT_FRESHNESS);
}

export function getBridgingSettings(): Promise<BridgingSettings> {
  return readSetting(SETTING_KEYS.bridging, DEFAULT_BRIDGING);
}

export function getLivenessSettings(): Promise<LivenessPolicy> {
  return readSetting(SETTING_KEYS.liveness, DEFAULT_LIVENESS);
}

export async function writeSetting(key: string, value: object, userId: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, valueJson: value as never, updatedById: userId },
    update: { valueJson: value as never, updatedById: userId },
  });
}
