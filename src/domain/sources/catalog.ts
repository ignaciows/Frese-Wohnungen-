/**
 * The three portals, and nothing else.
 *
 * This used to be a catalogue of ~50 sources: municipal landlords, temporary
 * housing sites, regional directories, a Telegram reader. In practice every
 * flat we ever contacted came from one of three places, and the other 47
 * spent the sweep's request budget on nothing. So the list is now exactly:
 *
 *   kleinanzeigen — read automatically, once a sweep
 *   immoscout24   — arrives by e-mail (Suchauftrag), see docs/QUELLEN.md
 *   immowelt      — arrives by e-mail (Suchauftrag), same route
 *
 * Adding a fourth means adding it here *and* teaching an adapter to read it.
 * That is deliberate: a source nobody can read is a source nobody uses.
 *
 * This file lives in `domain/` rather than next to the server action that
 * reads it, because `actions.ts` carries a "use server" directive and such a
 * file may only export async functions — exporting a plain array from there
 * type-checks fine and then breaks the production build.
 */

/** The keys the whole app treats as "the main sources". */
export const MAIN_SOURCE_KEYS = ['kleinanzeigen', 'immoscout24', 'immowelt'] as const;

export type MainSourceKey = (typeof MAIN_SOURCE_KEYS)[number];

/**
 * How a source actually reaches us. Two values, because there are two routes.
 *
 *  - `DISCOVERY` — the app reads the portal's own result list (robots-compliant,
 *    see docs/DISCOVERY.md). Only Kleinanzeigen allows this.
 *  - `EMAIL_ALERT` — the portal mails new hits to our shared mailbox because a
 *    colleague saved a search there. ImmoScout24 and Immowelt block automated
 *    reading and sell API access only to contract partners, so this is not a
 *    workaround — it is the route the portal itself provides.
 */
export type SourceRoute = 'DISCOVERY' | 'EMAIL_ALERT';

export interface SeedSource {
  key: MainSourceKey;
  name: string;
  websiteUrl: string;
  /** How listings from this source get in. */
  route: SourceRoute;
  /** Lower sorts first — decides the order on the sources screen. */
  priority: number;
  /**
   * Which discovery adapter can read this source (see domain/discovery).
   * Only set for `route: 'DISCOVERY'`. Naming an adapter is a statement about
   * the code, not permission to run it: a sweep only happens once an admin
   * also flips `discoveryEnabled` in the settings.
   */
  discoveryAdapter?: string;
  /**
   * Which of our search filters the portal itself can apply, so the recipe a
   * colleague follows says "set this on the portal" or "we filter it here".
   * `APPROXIMATE` means the portal has the filter but it means something
   * slightly different — usually Kaltmiete where we care about Warmmiete.
   */
  filters: Array<{
    filter: CanonicalFilter;
    quality: 'EXACT' | 'APPROXIMATE' | 'MANUAL' | 'UNSUPPORTED';
    portalLabel?: string;
    note?: string;
  }>;
  /** Shown on the sources screen. Plain German, one paragraph, no jargon. */
  notes: string;
  /** Extra hints for the person clicking through the portal by hand. */
  manualRecipe?: string;
}

export type CanonicalFilter =
  | 'location'
  | 'radiusKm'
  | 'maxWarmmiete'
  | 'minRooms'
  | 'minLivingSpace'
  | 'propertyType'
  | 'furnished'
  | 'wbs'
  | 'availableFrom'
  | 'pets';

/**
 * What the big marketplaces can and cannot filter. All three behave the same
 * way here, which is why it is written down once.
 *
 * The important line is `maxWarmmiete`: every portal filters on the Kaltmiete
 * while our budget is the Warmmiete. Search 10-20 % above the budget and let
 * the app's own ranking do the real filtering — see docs/QUELLEN.md.
 */
const MARKETPLACE_FILTERS: SeedSource['filters'] = [
  { filter: 'location', quality: 'EXACT', portalLabel: 'Ort/PLZ' },
  { filter: 'radiusKm', quality: 'EXACT', portalLabel: 'Umkreis' },
  {
    filter: 'maxWarmmiete',
    quality: 'APPROXIMATE',
    portalLabel: 'Kaltmiete bis',
    note: 'Portal filtert die Kaltmiete, unser Limit ist die Warmmiete — großzügiger suchen.',
  },
  { filter: 'minRooms', quality: 'EXACT', portalLabel: 'Zimmer ab' },
  { filter: 'minLivingSpace', quality: 'EXACT', portalLabel: 'Wohnfläche ab' },
  { filter: 'propertyType', quality: 'EXACT', portalLabel: 'Wohnungstyp' },
  { filter: 'furnished', quality: 'APPROXIMATE', note: 'Möblierung steht meist nur im Text — die App liest sie nach.' },
  { filter: 'wbs', quality: 'MANUAL', note: 'WBS-Pflicht steht nur im Text — die App liest sie nach.' },
  { filter: 'availableFrom', quality: 'MANUAL', note: '„Frei ab" steht nur im Text — die App liest es nach.' },
  { filter: 'pets', quality: 'MANUAL', note: 'Haustierklausel steht nur im Text — die App liest sie nach.' },
];

export const SEED_SOURCES: SeedSource[] = [
  {
    key: 'kleinanzeigen',
    name: 'Kleinanzeigen',
    websiteUrl: 'https://www.kleinanzeigen.de/s-wohnung-mieten/',
    route: 'DISCOVERY',
    priority: 10,
    discoveryAdapter: 'kleinanzeigen',
    filters: MARKETPLACE_FILTERS,
    notes:
      'Läuft von selbst. Die Ergebnisliste ist automatisch lesbar; die robots.txt sperrt allerdings Preis-, Umkreis- und Angebotsfilter sowie die Ortssuche — deshalb liest die App die ungefilterte Ortsliste und filtert selbst. Ortsnummern stehen in den Einstellungen; mehrere Orte ersetzen den Umkreis. Ein Portal-Zugang wird nur zum Antworten gebraucht.',
  },
  {
    key: 'immoscout24',
    name: 'ImmoScout24',
    websiteUrl: 'https://www.immobilienscout24.de/',
    route: 'EMAIL_ALERT',
    priority: 20,
    filters: MARKETPLACE_FILTERS,
    notes:
      'Sperrt automatische Abrufe (HTTP 401 auf Listenseiten), eine API gibt es nur für Vertragspartner. Der Weg, der funktioniert und erlaubt ist: im Portal einen Suchauftrag anlegen und die Treffer-Mails an das gemeinsame Postfach schicken lassen. Die App liest das Postfach mit jedem Suchlauf mit.',
    manualRecipe:
      'Im Portal anmelden → Suche mit Ort, Umkreis, Kaltmiete-Obergrenze und Mindestzimmern → „Suche speichern" → Benachrichtigung täglich (oder „Sofort", liefert schneller und deutlich mehr Mails) an das Suchagent-Postfach.',
  },
  {
    key: 'immowelt',
    name: 'Immowelt',
    websiteUrl: 'https://www.immowelt.de/',
    route: 'EMAIL_ALERT',
    priority: 30,
    filters: MARKETPLACE_FILTERS,
    notes:
      'Wie ImmoScout24: die Ergebnisliste ist zwar erreichbar, aber jede Exposé-Seite dahinter antwortet mit 403 — ein Suchlauf fände also nur Links, die er nicht lesen kann. Deshalb ebenfalls über den Suchauftrag per E-Mail. Immonet gehört zur selben Familie und taucht in denselben Mails auf.',
    manualRecipe:
      'Im Portal anmelden → Suche mit Ort, Umkreis, Kaltmiete-Obergrenze und Mindestzimmern → „Suchauftrag speichern" → täglich an das Suchagent-Postfach.',
  },
];

/** Convenience: the seed entry for a key, or null for anything unknown. */
export function seedSource(key: string): SeedSource | null {
  return SEED_SOURCES.find((s) => s.key === key) ?? null;
}
