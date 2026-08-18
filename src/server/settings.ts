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
import { DEFAULT_AGE_FILTER, type AgeFilterSettings } from '@/domain/timing/age';
import { DEFAULT_TELEGRAM, type NotificationSettings } from './telegram';
import { DEFAULT_FEATURES, type FeatureKey, type FeatureSettings, isFeatureOn } from '@/domain/features';

export const SETTING_KEYS = {
  sharing: 'sharing',
  sourceRecheck: 'sourceRecheck',
  systemTransfer: 'systemTransfer',
  freshness: 'freshness',
  bridging: 'bridging',
  liveness: 'liveness',
  telegram: 'telegram',
  discovery: 'discovery',
  outbound: 'outbound',
  followUp: 'followUp',
  ageFilter: 'ageFilter',
  quality: 'quality',
  mailbox: 'mailbox',
  features: 'features',
} as const;

export interface DiscoverySettings {
  /** Master switch for every automatic sweep. */
  enabled: boolean;
  /** A sweep only runs again after this many minutes, however often it is triggered. */
  sweepIntervalMinutes: number;
  /** Total HTTP requests one sweep may make, across all sources. */
  maxRequestsPerRun: number;
  /** Minimum gap between two requests to the same host. */
  perHostDelayMs: number;
  /** Result pages walked per source per query. */
  maxPagesPerSource: number;
  /**
   * Detail pages fetched per sweep to fill in the fields a result list omits.
   * Zero disables enrichment entirely.
   */
  enrichPerRun: number;
  /**
   * Consecutive successful sweeps an ad may be missing from its source's own
   * result list before it is retired. Two, so one hiccup never buries a flat.
   */
  retireAfterMissedSweeps: number;
  /** Skip ads whose rent is more than this factor above the candidate's cap. */
  priceSlack: number;
}

export const DEFAULT_DISCOVERY: DiscoverySettings = {
  enabled: true,
  sweepIntervalMinutes: 90,
  maxRequestsPerRun: 120,
  perHostDelayMs: 4000,
  maxPagesPerSource: 2,
  enrichPerRun: 25,
  retireAfterMissedSweeps: 2,
  priceSlack: 1.25,
};

export interface OutboundSettings {
  /** Allow the app to send Anfragen itself. Off until a mailbox is configured. */
  enabled: boolean;
  /** Display name on outgoing mail. */
  fromName: string;
  /**
   * Sending address. Replies are matched via plus-addressing on this address,
   * so the mailbox must accept `name+token@domain`.
   */
  fromAddress: string;
  /** Subject template; {title} and {city} are substituted. */
  subjectTemplate: string;
  /** Never send more than this many Anfragen per hour, across the whole team. */
  maxPerHour: number;
}

export const DEFAULT_OUTBOUND: OutboundSettings = {
  enabled: false,
  fromName: 'Frese Recruiting GmbH',
  fromAddress: '',
  subjectTemplate: 'Anfrage zu Ihrer Wohnung: {title}',
  maxPerHour: 20,
};

export interface FollowUpSettings {
  /** Days after sending an Anfrage before "has anyone answered?" appears. */
  checkReplyAfterDays: number;
  /** Second nudge this many days after the first, if still unanswered. */
  secondCheckAfterDays: number;
  /** Create the reply-check task automatically on every contact. */
  autoCreate: boolean;
}

export const DEFAULT_FOLLOW_UP: FollowUpSettings = {
  checkReplyAfterDays: 3,
  secondCheckAfterDays: 4,
  autoCreate: true,
};

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

/**
 * What cannot be a flat for one of our candidates.
 *
 * Every portal search returns things that are technically adverts and
 * practically impossible: a room at 100 € a month, a "flat" with twenty rooms,
 * a place let for four weeks around a trade fair. They are not errors in the
 * parser — the portals really do list them — and each one is a line a
 * colleague has to read past. The bounds are settings rather than constants
 * because "impossible" depends on the town and the year.
 */
export interface QualitySettings {
  /** Nobody moves into a flat at this price; below it, it is a room or a night. */
  minMonthlyEuros: number;
  /** Above it, it is a house, a holiday let or a typo. Independent of a candidate's own budget. */
  maxMonthlyEuros: number;
  /** A twenty-room "flat" is a building. */
  maxRooms: number;
  /** Below this, it is a room in a shared flat however it is labelled. */
  minSqm: number;
  /** Reject adverts whose own words say the let is by the week or for a season. */
  rejectShortStay: boolean;
}

export const DEFAULT_QUALITY: QualitySettings = {
  minMonthlyEuros: 250,
  maxMonthlyEuros: 2500,
  maxRooms: 6,
  minSqm: 15,
  rejectShortStay: true,
};

/**
 * How the app is allowed to behave inside somebody else's inbox.
 *
 * The mailbox this reads is a shared one — the team works it in Front, and a
 * landlord's reply sitting there unread is how a colleague knows to answer it.
 * Marking mail as read to remember "already handled" is convenient for us and
 * destructive for them: replies would silently vanish from the unread list of
 * the person whose job it is to see them.
 *
 * So read-only is the default. It costs nothing: idempotency never depended on
 * the flag, it comes from the unique Message-ID in `EmailIngestLog`. The flag
 * was only an optimisation for which mails to fetch, and a lookback window
 * does that job without writing anything at all.
 */
export interface MailboxSettings {
  /** Never write to the mailbox — no flags, no moves, no deletions. */
  readOnly: boolean;
  /** In read-only mode: how far back to look on each run. */
  lookbackDays: number;
}

export const DEFAULT_MAILBOX: MailboxSettings = {
  readOnly: true,
  lookbackDays: 14,
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

export function getTelegramSettings(): Promise<NotificationSettings> {
  return readSetting(SETTING_KEYS.telegram, DEFAULT_TELEGRAM);
}

export function getDiscoverySettings(): Promise<DiscoverySettings> {
  return readSetting(SETTING_KEYS.discovery, DEFAULT_DISCOVERY);
}

export function getOutboundSettings(): Promise<OutboundSettings> {
  return readSetting(SETTING_KEYS.outbound, DEFAULT_OUTBOUND);
}

export function getFollowUpSettings(): Promise<FollowUpSettings> {
  return readSetting(SETTING_KEYS.followUp, DEFAULT_FOLLOW_UP);
}

export function getAgeFilterSettings(): Promise<AgeFilterSettings> {
  return readSetting(SETTING_KEYS.ageFilter, DEFAULT_AGE_FILTER);
}

export function getQualitySettings(): Promise<QualitySettings> {
  return readSetting(SETTING_KEYS.quality, DEFAULT_QUALITY);
}

export function getMailboxSettings(): Promise<MailboxSettings> {
  return readSetting(SETTING_KEYS.mailbox, DEFAULT_MAILBOX);
}

export async function writeSetting(key: string, value: object, userId: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, valueJson: value as never, updatedById: userId },
    update: { valueJson: value as never, updatedById: userId },
  });
}


/* -------------------------------------------------------- Bausteine ----- */

/**
 * Welche Bausteine der App an sind — siehe `domain/features`.
 *
 * Gespeichert wird nur, was ein Mensch bewusst umgestellt hat; alles andere
 * fehlt schlicht und bekommt seinen Standard. Ein neuer Baustein taucht damit
 * automatisch in seinem Auslieferungszustand auf, statt für alle bestehenden
 * Installationen als „aus" zu gelten.
 */
export function getFeatureSettings(): Promise<FeatureSettings> {
  return readSetting(SETTING_KEYS.features, DEFAULT_FEATURES);
}

/**
 * Ist dieser Baustein an? Die Abkürzung für den häufigsten Fall — eine Seite
 * will genau eine Funktion abfragen und nicht die ganze Tabelle lesen.
 */
export async function featureOn(key: FeatureKey): Promise<boolean> {
  return isFeatureOn(await getFeatureSettings(), key);
}
