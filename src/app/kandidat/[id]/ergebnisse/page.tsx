import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { Empty, Callout } from '@/app/_components/Shell';
import { LiveSearch } from '@/app/_components/LiveSearch';
import { WhatIfPanel } from '@/app/_components/WhatIfPanel';
import { ContactFlow } from '@/app/_components/ContactFlow';
import { AvailableFromPicker } from '@/app/_components/AvailableFromPicker';
import { favoriteListingAction, rejectListingAction } from '@/app/actions';
import { formatEuroCents } from '@/lib/money';
import { COMPATIBILITY, FURNISHING, MATCH_STATUS, formatDate } from '@/lib/labels';
import {
  evaluateFreshness,
  evaluateMoveInTiming,
  firstPeriodCostCents,
  type BridgingSettings,
  type FreshnessSettings,
} from '@/domain/timing';
import {
  getFreshnessSettings,
  getBridgingSettings,
  getOutboundSettings,
  getLivenessSettings,
  getAgeFilterSettings,
} from '@/server/settings';
import { listingAge, passesAgeFilter, describeAgeFilter } from '@/domain/timing/age';
import { DEAD_LISTING, liveListingFilter, limboListingFilter } from '@/server/listingFilters';
import { assessRent } from '@/domain/rent';
import { MAX_SCORE } from '@/domain/ranking';
import {
  bandOf,
  describeBand,
  describeRecency,
  livenessScoreFactor,
  type LivenessPolicy,
  type LivenessSignal,
} from '@/domain/liveness';
import { markListingExpiredAction, checkListingNowAction, setFollowUpAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

/**
 * Nine tabs, of which two are the job.
 *
 * Somebody opens this screen every few days to write five or ten Anfragen.
 * "Zu kontaktieren" is what they came for and "Kontaktiert" is how they check
 * themselves; the other seven are bookkeeping, and shown at equal weight they
 * made the two that matter hard to find. `always` stays visible even at zero,
 * because an empty "Zu kontaktieren" is itself the answer. The rest appear
 * only once they hold something.
 */
const TABS = [
  { key: 'zu-kontaktieren', label: 'Zu kontaktieren', always: true },
  { key: 'kontaktiert', label: 'Kontaktiert', always: true },
  { key: 'in-arbeit', label: 'In Arbeit', always: false },
  { key: 'wiedervorlage', label: 'Wiedervorlage', always: false },
  { key: 'favoriten', label: 'Favoriten', always: false },
  { key: 'zu-pruefen', label: 'Zu prüfen', always: false },
  { key: 'abgelehnt', label: 'Abgelehnt', always: false },
  { key: 'abgelaufen', label: 'Abgelaufen', always: false },
  { key: 'alle', label: 'Alle', always: true },
] as const;

/**
 * How long a vanished ad stays visible after it goes.
 *
 * Not forever: the graveyard grows every sweep and is read by nobody. A few
 * days is enough to see what was missed this week — after that it is noise on
 * a screen whose whole value is being short. Anything anyone wrote to is
 * exempt and lives in its own tab, because a conversation outlives the ad.
 */
const EXPIRED_VISIBLE_DAYS = 7;

/**
 * What is holding a listing back, in three words or fewer, for the row.
 *
 * The score already says *how* good a flat is; a colleague's next question is
 * always *why isn't it better*, and until now the answer only existed inside
 * the detail pane. The scoring reasons carry it: "−" marks a weak dimension
 * and "!" a missing fact, so those become chips and everything positive stays
 * out of the row.
 */
function shortcomings(reasons: unknown, limit = 3): string[] {
  if (!Array.isArray(reasons)) return [];
  return (reasons as string[])
    .filter((r) => typeof r === 'string' && (r.startsWith('−') || r.startsWith('-') || r.startsWith('!')))
    .map((r) => r.slice(1).trim())
    // The recency footnote is on every row and is not a shortcoming.
    .filter((r) => r && !r.startsWith('Grundwert'))
    .slice(0, limit);
}

type MatchStatusValue = 'NEW' | 'FAVORITE' | 'IN_PROGRESS' | 'CONTACTED' | 'REJECTED' | 'EXPIRED';

/**
 * The working list holds nothing that cannot be written to.
 *
 * On a real candidate, 234 of 311 live matches were INCOMPATIBLE — three
 * quarters of the screen was flats in the wrong city, over budget, or the
 * wrong kind of property, each one already marked "Nicht passend". Nobody is
 * going to write to those, and having to look past them to find the twenty-one
 * that work is the exact job this tool exists to remove. They stay reachable
 * under "Alle", with a line saying how many were set aside and why.
 */
function statusFilter(tab: string): {
  status?: MatchStatusValue | { in: MatchStatusValue[] };
  compatibility?: { not: 'INCOMPATIBLE' };
} {
  switch (tab) {
    case 'zu-kontaktieren':
      return { status: { in: ['NEW', 'FAVORITE'] }, compatibility: { not: 'INCOMPATIBLE' } };
    case 'favoriten':
      return { status: 'FAVORITE' };
    case 'in-arbeit':
      return { status: 'IN_PROGRESS' };
    case 'kontaktiert':
      return { status: 'CONTACTED' };
    case 'abgelehnt':
      return { status: { in: ['REJECTED', 'EXPIRED'] } };
    default:
      return {};
  }
}

export default async function ErgebnissePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; listing?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  // Straight to the work. Landing on "Alle" meant the first thing on screen
  // was a mixed pile including the rejected and the long-dead, and the tab
  // that answers "what do I write today?" had to be found first.
  const tab = sp.tab ?? 'zu-kontaktieren';

  const [liveness, ageFilter] = await Promise.all([getLivenessSettings(), getAgeFilterSettings()]);
  const expiredCutoff = new Date(Date.now() - EXPIRED_VISIBLE_DAYS * 86_400_000);

  const [matchList, counts, message, profile, freshnessSettings, bridging] = await Promise.all([
    prisma.candidateListingMatch.findMany({
      where: {
        candidateCaseId: id,
        ...statusFilter(tab),
        ...(tab === 'wiedervorlage' ? { followUpAt: { not: null } } : {}),
        // Dead ads only show in their own tab, so the working list stays
        // trustworthy. A single confident GONE already hides the listing —
        // waiting for the second strike would keep sending people to a 404.
        //
        // The exception is anything we have already written to: a conversation
        // outlives the ad behind it, and hiding it would lose the reply we are
        // still waiting for. Those tabs therefore show live and dead alike.
        ...(tab === 'kontaktiert' || tab === 'in-arbeit'
          ? {}
          : {
              listing:
                tab === 'abgelaufen'
                  ? { ...DEAD_LISTING, expiredAt: { gte: expiredCutoff } }
                  : tab === 'zu-pruefen'
                    ? limboListingFilter(liveness)
                    : liveListingFilter(liveness),
            }),
      },
      orderBy: [{ compatibility: 'asc' }, { score: 'desc' }],
      include: { listing: { include: { source: { select: { name: true } } } } },
    }),
    prisma.candidateListingMatch.groupBy({
      by: ['status'],
      where: { candidateCaseId: id },
      _count: true,
    }),
    prisma.applicationMessage.findUnique({ where: { candidateCaseId: id } }),
    prisma.searchProfile.findUnique({ where: { candidateCaseId: id } }),
    getFreshnessSettings(),
    getBridgingSettings(),
  ]);
  const arrival = profile?.moveInDate ?? null;
  const expiredCount = await prisma.candidateListingMatch.count({
    where: {
      candidateCaseId: id,
      // Counted over the same window the tab shows, or the number promises
      // rows the list will not produce.
      listing: { ...DEAD_LISTING, expiredAt: { gte: expiredCutoff } },
    },
  });

  const followUpCount = await prisma.candidateListingMatch.count({
    where: { candidateCaseId: id, followUpAt: { not: null } },
  });

  const limboCount = await prisma.candidateListingMatch.count({
    where: { candidateCaseId: id, listing: limboListingFilter(liveness) },
  });

  // Nothing vanishes without being counted. Three quarters of a real
  // candidate's matches are unusable, and a list that silently drops them is
  // one nobody can trust the size of.
  const setAside = await prisma.candidateListingMatch.count({
    where: {
      candidateCaseId: id,
      status: { in: ['NEW', 'FAVORITE'] },
      compatibility: 'INCOMPATIBLE',
      listing: liveListingFilter(liveness),
    },
  });

  type MatchRow = (typeof matchList)[number];
  // Order inside each compatibility group by the score the detector's reading
  // adjusts: a confirmed-live ad posted this morning outranks an equally good
  // one nobody could verify. The reading only reorders — it never removes,
  // which is what keeps a misread ad reachable.
  // The age filter runs here rather than in SQL: the age of an ad depends on
  // which date it has (portal, alert, or our own import), and that choice is
  // the domain rule in listingAge — duplicating it in a query is how the badge
  // and the filter end up disagreeing.
  const ageOf = (m: MatchRow) =>
    listingAge({
      postedAt: m.listing.postedAt,
      firstSeenAt: m.listing.firstSeenAt,
      importedAt: m.listing.importedAt,
    });
  const ageNote = describeAgeFilter(matchList.map(ageOf), ageFilter);
  const withinAge = matchList.filter((m) => passesAgeFilter(ageOf(m), ageFilter));

  // Best first, full stop.
  //
  // The list used to group by compatibility and only sort by score inside each
  // group, which meant number 1 was not necessarily the best flat on screen —
  // and this list is meant to be worked from the top down until the day's
  // enquiries are out. Anything unusable is already filtered out of the working
  // tabs, so there is nothing left for the grouping to protect.
  const matches: MatchRow[] = [...withinAge].sort(
    (a, b) => effectiveScore(b, liveness) - effectiveScore(a, liveness),
  );

  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  const tabCount = (key: string) => {
    switch (key) {
      case 'alle':
        return counts.reduce((n, c) => n + c._count, 0);
      case 'zu-kontaktieren':
        return (byStatus.NEW ?? 0) + (byStatus.FAVORITE ?? 0);
      case 'favoriten':
        return byStatus.FAVORITE ?? 0;
      case 'in-arbeit':
        return byStatus.IN_PROGRESS ?? 0;
      case 'kontaktiert':
        return byStatus.CONTACTED ?? 0;
      case 'abgelehnt':
        return (byStatus.REJECTED ?? 0) + (byStatus.EXPIRED ?? 0);
      case 'wiedervorlage':
        return followUpCount;
      case 'zu-pruefen':
        return limboCount;
      case 'abgelaufen':
        return expiredCount;
      default:
        return 0;
    }
  };

  const selected = sp.listing ? matches.find((m) => m.listingId === sp.listing) ?? null : null;
  const totalAll = counts.reduce((n, c) => n + c._count, 0);

  const usableNow = await prisma.candidateListingMatch.count({
    where: {
      candidateCaseId: id,
      compatibility: { in: ['COMPATIBLE', 'NEAR_MATCH'] },
      listing: liveListingFilter(liveness),
    },
  });

  return (
    <div className="stack">
      <LiveSearch candidateCaseId={id} />
      {ageNote ? <Callout tone="info">{ageNote}</Callout> : null}
      {sp.error ? (
        <Callout tone="danger">
          {sp.error === 'ALREADY_CONTACTED_SAME_CANDIDATE'
            ? 'Diese Wohnung wurde für diesen Kandidaten bereits kontaktiert — ein zweiter Kontakt ist gesperrt.'
            : sp.error === 'ALREADY_CONTACTED_OTHER_CANDIDATE'
              ? 'Achtung: Diese Wohnung wurde bereits für einen anderen Kandidaten kontaktiert.'
              : sp.error}
        </Callout>
      ) : null}

      {profile ? (
        <WhatIfPanel
          candidateCaseId={id}
          startOpen={totalAll > 0 && usableNow === 0}
          current={{
            maxWarmmieteEuros: Math.round(profile.maxWarmmieteCents / 100),
            minRooms: profile.minRooms,
            maxCommuteMinutes: profile.maxCommuteMinutes ?? 35,
            radiusKm: profile.radiusKm ?? 20,
            furnished: profile.furnished,
            temporaryMode: profile.temporaryMode,
          }}
        />
      ) : null}

      <nav className="tabs" aria-label="Status">
        {TABS.filter((t) => t.always || tabCount(t.key) > 0 || tab === t.key).map((t) => (
          <Link
            key={t.key}
            href={`/kandidat/${id}/ergebnisse?tab=${t.key}`}
            className="tab"
            aria-current={tab === t.key ? 'page' : undefined}
          >
            {t.label}
            <span className="tab-count">{tabCount(t.key)}</span>
          </Link>
        ))}
      </nav>

      {tab === 'zu-kontaktieren' && setAside > 0 ? (
        <p className="listing-note">
          {setAside} weitere Anzeige(n) sind ausgeblendet, weil sie nicht zum Profil passen — falscher
          Ort, über Budget oder falscher Objekttyp.{' '}
          <Link href={`/kandidat/${id}/ergebnisse?tab=alle`}>Trotzdem ansehen</Link>
        </p>
      ) : null}

      {totalAll === 0 ? (
        <div className="card">
          <Empty
            icon="↓"
            title="Noch keine Anzeigen importiert"
            action={
              <Link href={`/kandidat/${id}/quellen`} className="btn primary">
                Zu den Quellen
              </Link>
            }
          >
            Die automatische Suche läuft nur für Quellen, die in den Einstellungen freigeschaltet sind —
            und Portale wie ImmoScout24 sperren automatische Abrufe grundsätzlich. Für alles Übrige: Quelle
            öffnen, mit dem angezeigten Rezept suchen und Anzeigen importieren.
          </Empty>
        </div>
      ) : matches.length === 0 ? (
        <div className="card">
          <Empty icon="○" title="Nichts in diesem Reiter">
            In „{TABS.find((t) => t.key === tab)?.label}“ liegt gerade nichts. Wechsle auf „Alle“, um alle
            {' '}
            {totalAll} Anzeigen zu sehen.
          </Empty>
        </div>
      ) : (
        <div className={`results-grid ${selected ? 'with-pane' : ''}`}>
          <div className="card">
            {matches.map((m, i) => {
              const l = m.listing;
              const comp = COMPATIBILITY[m.compatibility] ?? COMPATIBILITY.INSUFFICIENT_DATA;
              const st = MATCH_STATUS[m.status] ?? MATCH_STATUS.NEW;
              // Colour follows the number on the box.
              //
              // It used to follow the compatibility verdict instead, so a 67
              // was green and a 74 amber on the same screen — the one thing a
              // colour-coded number must never do. Bands, not verdicts: 80 and
              // up is worth writing to today, 60 to 79 is worth a look, below
              // that is the bottom of the list.
              const shown = Math.round(effectiveScore(m, liveness));
              const scoreCls = shown >= 80 ? 'good' : shown >= 60 ? 'mid' : 'low';
              // The date the ad prints about itself beats the date we happened
              // to import it: an ad found this morning can already be three
              // weeks old, and that is exactly what decides whether it is worth
              // writing to.
              const fresh = evaluateFreshness(
                {
                  firstSeenAt: l.postedAt ?? l.importedAt,
                  lastSeenAt: l.postedAt ? null : l.lastSeenAt,
                  expired: l.expired,
                },
                freshnessSettings,
              );
              const band = bandOf(l, liveness);
              const timing = evaluateMoveInTiming(
                l.availableFrom,
                arrival,
                l.effectiveMonthlyCents,
                bridging,
              );
              return (
                <div key={m.id} className="listing-row">
                <Link
                  href={`/kandidat/${id}/ergebnisse?tab=${tab}&listing=${l.id}`}
                  className={`listing ${selected?.listingId === l.id ? 'selected' : ''}`}
                >
                  {/* No photo: the portals' image hosts refuse us, so every row
                      carried the same grey placeholder — a hundred pixels of
                      column saying nothing. The score takes the space back. */}
                  <span className={`listing-score ${scoreCls}`}>
                    {m.compatibility === 'INCOMPATIBLE' ? '×' : shown}
                  </span>
                  <span className="listing-main">
                    <span className="listing-title">
                      <span className="listing-rank">{i + 1}</span>
                      {l.title}
                    </span>
                    {/* The three facts that decide whether to open an ad, big
                        enough to read at a glance. Everything else is either in
                        the detail pane or, if it is an "unknown", not shown at
                        all — a row that announces "Möblierung unbekannt" has
                        spent a line saying nothing. */}
                    <span className="listing-facts">
                      {/* What it will cost, not what the advert printed. Two
                          thirds of adverts state only a Kaltmiete, and a bare
                          "780 €" next to a warm budget is the wrong number in
                          the wrong direction. The asterisk said "incomplete"
                          and left the reader to guess by how much. */}
                      <span className="fact-price">
                        {rentOf(l).basisCents != null
                          ? rentOf(l).basisKind === 'ESTIMATED'
                            ? `ca. ${formatEuroCents(rentOf(l).basisCents!)}`
                            : formatEuroCents(rentOf(l).basisCents!)
                          : 'Preis unbekannt'}
                      </span>
                      {rentOf(l).basisKind === 'ESTIMATED' && l.kaltMieteCents != null ? (
                        <span className="fact subtle">{formatEuroCents(l.kaltMieteCents)} kalt</span>
                      ) : null}
                      {l.rooms != null ? <span className="fact">{l.rooms} Zimmer</span> : null}
                      {l.livingSpaceSqm != null ? <span className="fact">{l.livingSpaceSqm} m²</span> : null}
                      {l.locationCity ? <span className="fact">{l.locationCity}</span> : null}
                    </span>

                    <span className="listing-meta">
                      {/* Only when it is news. A row that says "Passend" next
                          to a green 84 has spent a badge repeating the number.
                          What is worth the space is what is *missing*. */}
                      {m.compatibility !== 'COMPATIBLE' ? (
                        <span className={`badge ${comp.tone}`}>{comp.short}</span>
                      ) : null}
                      {shortcomings(m.reasons).map((r, k) => (
                        <span key={k} className="lack" title={r}>
                          {r}
                        </span>
                      ))}
                      {/* Only say something about the check when it is news.
                          "Noch nicht geprüft" sat on every row, and a label
                          that never varies is one more thing to read past. */}
                      {band === 'DEAD' ? (
                        <span className="badge danger" title={l.lastCheckReason ?? undefined}>
                          Nicht mehr verfügbar
                        </span>
                      ) : band === 'LIMBO' ? (
                        <span className="badge warning" title={l.lastCheckReason ?? undefined}>
                          Unsicher — bitte prüfen
                        </span>
                      ) : null}
                      {timing.verdict === 'BRIDGE_NEEDED' || timing.verdict === 'BRIDGE_TOO_LONG' ? (
                        <span className="badge warning">
                          {timing.bridgeNights} Tage Lücke ≈ {formatEuroCents(timing.bridgeCostCents)}
                        </span>
                      ) : null}
                      {fresh.state === 'STALE' ? (
                        <span className="badge warning">Älter — evtl. vergeben</span>
                      ) : null}
                      {/* Die Anzeige nennt selbst eine Telefonnummer. Das ist
                          der schnellste Weg zu einer Besichtigung, den es gibt
                          — und deshalb ein Grund, diese Zeile zuerst
                          anzufassen. Details stehen im Kontakt-Bereich rechts. */}
                      {l.contactPhone ? (
                        <span className="badge success" title={`Telefon: ${l.contactPhone}`}>
                          ☎ Telefon in der Anzeige
                        </span>
                      ) : l.contactEmail ? (
                        <span className="badge" title={`E-Mail: ${l.contactEmail}`}>
                          ✉ Direkt erreichbar
                        </span>
                      ) : null}
                      {/* One statement of age, not three. */}
                      <span className={`chip ${fresh.state === 'NEW' ? 'accent' : ''}`}>
                        {l.postedAt
                          ? fresh.state === 'NEW'
                            ? 'Neu — heute inseriert'
                            : `Inseriert ${formatDate(l.postedAt)}`
                          : fresh.state === 'NEW'
                            ? 'Neu gefunden'
                            : `Gefunden ${formatDate(l.importedAt)}`}
                      </span>
                      <span className="listing-source">{l.source.name}</span>
                    </span>

                  </span>
                  <span className="listing-side">
                    {/* Only a status somebody *did* something to get.
                        "Neu" here meant "nobody has worked on it", which sat on
                        every row and, worse, collided with the "Neu" in the row
                        above meaning "recently advertised" — the same word for
                        two different things. Untouched is the default; it needs
                        no label. */}
                    {m.status === 'CONTACTED' ? (
                      <span className="badge success" title="Bereits angeschrieben">
                        ✓ Angeschrieben
                      </span>
                    ) : m.status !== 'NEW' ? (
                      <span className={`badge ${st.tone}`}>
                        {st.icon} {st.label}
                      </span>
                    ) : null}
                    {m.followUpAt ? (
                      <span
                        className={`badge ${m.followUpAt <= new Date() ? 'warning' : ''}`}
                        title={m.followUpNote ?? undefined}
                      >
                        ⏱ {m.followUpAt <= new Date() ? 'Wiedervorlage fällig' : `WV ${formatDate(m.followUpAt)}`}
                      </span>
                    ) : null}
                  </span>
                </Link>
                {/* Outside the row link on purpose: an anchor inside an anchor
                    is invalid, and this one leaves the app. It is what the row
                    is ultimately for — read the advert at the portal. */}
                <a
                  href={l.rawUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn sm listing-open"
                  title="Anzeige beim Portal öffnen"
                >
                  Öffnen ↗
                </a>
                </div>
              );
            })}
            {/* One footnote for the whole list. It used to be repeated on
                every Kleinanzeigen row, where it said the same thing eleven
                times and crowded out what differed between them. */}
            {matches.some((m) => !m.listing.monthlyTotalComplete) ? (
              <div className="listing-note">
                <strong>„ca.&ldquo;</strong> heißt: das Portal nennt nur die Kaltmiete. Die Nebenkosten sind
                mit 2,50 €/m² geschätzt — der deutsche Durchschnitt — damit die Zahl mit dem Budget
                vergleichbar ist. Der genaue Betrag steht erst in der Anzeige selbst.
              </div>
            ) : null}
          </div>

          {selected ? (
            <DetailPane
              candidateId={id}
              match={selected}
              message={message?.body ?? ''}
              tab={tab}
              arrival={arrival}
              freshnessSettings={freshnessSettings}
              bridging={bridging}
              liveness={liveness}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * The preference score after the detector's reading is applied. Kept out of the
 * stored score on purpose: the stored score answers "does this flat fit the
 * candidate", which does not change when a portal blocks us for an afternoon.
 */
/** The monthly figure to show and to judge, with the Nebenkosten filled in. */
function rentOf(l: {
  kaltMieteCents: number | null;
  effectiveMonthlyCents: number | null;
  monthlyTotalComplete: boolean;
  livingSpaceSqm: number | null;
}) {
  return assessRent({
    kaltMieteCents: l.kaltMieteCents,
    warmMieteCents: l.monthlyTotalComplete ? l.effectiveMonthlyCents : null,
    livingSpaceSqm: l.livingSpaceSqm,
  });
}

/**
 * The number the row shows, and the number the list sorts by.
 *
 * Freshness moves it — a confirmed-live advert posted this morning outranks an
 * equally good one nobody could verify — but it can never push a listing past
 * the ceiling its own unknowns impose. Without that clamp the bonus produced a
 * green **100** on an advert whose row simultaneously said the distance was
 * unknown and no move-in date was given, which is the screen arguing with
 * itself. See certaintyCap() in domain/ranking.
 */
function effectiveScore(
  match: {
    score: number;
    breakdown?: unknown;
    listing: { onlineConfidence: number | null; postedAt: Date | null; firstSeenAt: Date | null };
  },
  policy: LivenessPolicy,
): number {
  const boosted = match.score * livenessScoreFactor(match.listing, policy);
  const cap =
    match.breakdown && typeof match.breakdown === 'object' && 'cap' in match.breakdown
      ? Number((match.breakdown as { cap: unknown }).cap) || MAX_SCORE
      : MAX_SCORE;
  return Math.min(boosted, cap, MAX_SCORE);
}

interface DetailMatch {
  status: string;
  followUpAt: Date | null;
  followUpNote: string | null;
  score: number;
  compatibility: string;
  reasons: unknown;
  blockers: unknown;
  listing: {
    id: string;
    title: string;
    rawUrl: string;
    imageUrl: string | null;
    descriptionRaw: string;
    locationRaw: string;
    locationCity: string | null;
    locationPostal: string | null;
    furnishing: string;
    rooms: number | null;
    livingSpaceSqm: number | null;
    effectiveMonthlyCents: number | null;
    monthlyTotalComplete: boolean;
    warnings: string[];
    availableFrom: Date | null;
    importedAt: Date;
    lastSeenAt: Date | null;
    expired: boolean;
    expiredBySystem: boolean;
    lastCheckedAt: Date | null;
    lastCheckStatus: string | null;
    lastCheckReason: string | null;
    onlineConfidence: number | null;
    livenessSignals: unknown;
    postedAt: Date | null;
    postedAtLabel: string | null;
    // The recency part of the score falls back to this when the portal prints
    // no publication date, so the detail pane must carry it too — otherwise it
    // explains a different number from the one the list sorted by.
    firstSeenAt: Date | null;
    /// Only set when the ad itself publishes them. The address decides whether
    /// the enquiry can be sent from here or has to go through the portal form;
    /// the number is the fastest route of all and goes to the top of the pane.
    contactEmail: string | null;
    contactPhone: string | null;
    contactName: string | null;
    source: { name: string };
  };
}

async function DetailPane({
  candidateId,
  match,
  message,
  tab,
  arrival,
  freshnessSettings,
  bridging,
  liveness,
}: {
  candidateId: string;
  match: DetailMatch;
  message: string;
  tab: string;
  arrival: Date | null;
  freshnessSettings: FreshnessSettings;
  bridging: BridgingSettings;
  liveness: LivenessPolicy;
}) {
  const l = match.listing;
  // Whether the send button can appear at all. Read here rather than threaded
  // down from the page, because only this pane needs it.
  const outbound = await getOutboundSettings();
  const sendingEnabled = outbound.enabled && !!outbound.fromAddress.trim();

  // Warn if this exact listing was already contacted for someone else.
  const otherContact = await prisma.contactAttempt.findFirst({
    where: { listingId: l.id, candidateCaseId: { not: candidateId } },
    include: { candidateCase: { select: { reference: true } }, user: { select: { name: true } } },
  });

  const reasons = Array.isArray(match.reasons) ? (match.reasons as string[]) : [];
  const blockers = Array.isArray(match.blockers) ? (match.blockers as string[]) : [];
  const comp = COMPATIBILITY[match.compatibility] ?? COMPATIBILITY.INSUFFICIENT_DATA;

  return (
    /* A column of its own height, not a card that scrolls with the page.
       Scrolling the page pushed the buttons off the bottom of the screen, so
       the thing the pane exists for — writing to this landlord — was the first
       thing to disappear. The middle scrolls; the verdict at the top and the
       actions at the bottom stay put. */
    <aside className="pane">
      <div className="pane-head">
        <div className="row-wrap">
          <span className={`badge ${comp.tone}`}>{comp.label}</span>
          <span className="badge brand">{Math.round(match.score)} Punkte</span>
        </div>
        <Link
          href={`/kandidat/${candidateId}/ergebnisse?tab=${tab}`}
          className="btn ghost sm"
          aria-label="Detailansicht schließen"
        >
          Schließen
        </Link>
      </div>

      <div className="pane-scroll">
        <div className="stack">
          <h3>{l.title}</h3>
          <div className="row-wrap">
            <span className="badge">{l.source.name}</span>
            <span className="chip">{FURNISHING[l.furnishing]}</span>
            <span className="chip">{l.rooms != null ? `${l.rooms} Zimmer` : 'Zimmer unbekannt'}</span>
            {l.livingSpaceSqm ? <span className="chip">{l.livingSpaceSqm} m²</span> : null}
            <span className="chip">{[l.locationPostal, l.locationCity].filter(Boolean).join(' ') || l.locationRaw}</span>
          </div>

          <div className="grid-2">
            <div className="stat">
              <div className="stat-value" style={{ fontSize: 19 }}>
                {l.effectiveMonthlyCents != null ? formatEuroCents(l.effectiveMonthlyCents) : 'Unbekannt'}
              </div>
              <div className="stat-label">
                {l.monthlyTotalComplete ? 'Warmmiete (vollständig)' : 'Gesamtkosten unvollständig'}
              </div>
            </div>
            <div className="stat">
              <div className="stat-value" style={{ fontSize: 19 }}>
                {l.availableFrom ? formatDate(l.availableFrom) : 'Unbekannt'}
              </div>
              <div className="stat-label">Verfügbar ab</div>
              {/* The date the advert did not print, but the landlord said on
                  the phone. Without it this flat scores nothing for timing. */}
              <AvailableFromPicker listingId={l.id} current={l.availableFrom} />
            </div>
          </div>

          <TimingBlock
            listing={l}
            arrival={arrival}
            freshnessSettings={freshnessSettings}
            bridging={bridging}
            liveness={liveness}
          />

          {blockers.length > 0 ? (
            <div className="callout danger">
              <span className="callout-icon" aria-hidden>
                !
              </span>
              <div>
                <strong>Nicht passend, weil:</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {blockers.map((b, i) => (
                    <li key={i} className="small">
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {reasons.length > 0 ? (
            <div className="stack-sm">
              <h4>Warum diese Bewertung</h4>
              {/* The number at the top of the row is the base score moved by
                  how fresh the ad is, and the reader could not see that half
                  of it. An unexplained number is one nobody trusts, and this
                  one decides the order of the whole list. */}
              {(() => {
                const recency = describeRecency(l);
                const factor = livenessScoreFactor(l, liveness);
                return (
                  <div className="reason neutral">
                    <span className="mark">=</span>
                    <span>
                      Grundwert {Math.round(match.score)}
                      {factor !== 1
                        ? ` × ${factor.toFixed(2)} (Aktualität & Prüfstatus) = ${Math.round(
                            match.score * factor,
                          )}`
                        : ' — unverändert'}
                      {recency ? `. ${recency}.` : ''}
                    </span>
                  </div>
                );
              })()}
              {reasons.map((r, i) => {
                const cls = r.startsWith('+') ? 'plus' : r.startsWith('−') || r.startsWith('-') ? 'minus' : r.startsWith('!') ? 'warn' : 'neutral';
                return (
                  <div key={i} className={`reason ${cls}`}>
                    <span className="mark">{r.slice(0, 1)}</span>
                    <span>{r.slice(1).trim()}</span>
                  </div>
                );
              })}
            </div>
          ) : null}

          {l.warnings.length > 0 ? (
            <div className="callout warning">
              <span className="callout-icon" aria-hidden>
                !
              </span>
              <div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {l.warnings.map((w, i) => (
                    <li key={i} className="small">
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          <details>
            <summary className="small muted" style={{ cursor: 'pointer' }}>
              Original-Anzeigentext
            </summary>
            <p className="pre-wrap small muted" style={{ marginTop: 8 }}>
              {l.descriptionRaw || '—'}
            </p>
          </details>

          <a href={l.rawUrl} target="_blank" rel="noopener noreferrer" className="small">
            Original-Anzeige öffnen ↗
          </a>

          <div className="divider" />

          <form action={setFollowUpAction} className="stack-sm">
          <input type="hidden" name="candidateCaseId" value={candidateId} />
          <input type="hidden" name="listingId" value={l.id} />
          <label htmlFor={`wv-${l.id}`}>Wiedervorlage — später nochmal ansehen</label>
          <div className="row">
            <input
              id={`wv-${l.id}`}
              name="followUpAt"
              type="date"
              className="input"
              style={{ maxWidth: 170 }}
              defaultValue={match.followUpAt ? match.followUpAt.toISOString().slice(0, 10) : ''}
            />
            <input
              name="followUpNote"
              className="input"
              placeholder="Notiz (optional)"
              defaultValue={match.followUpNote ?? ''}
            />
            <button type="submit" className="btn sm">
              Setzen
            </button>
          </div>
          <p className="field-hint">
            Leer lassen und speichern entfernt die Wiedervorlage. Fällige stehen im Reiter
            „Wiedervorlage“.
          </p>
        </form>

        <form action={markListingExpiredAction}>
          <input type="hidden" name="listingId" value={l.id} />
          <input type="hidden" name="expired" value={l.expired ? 'false' : 'true'} />
          <button type="submit" className="btn sm block">
            {l.expired ? 'Wieder als aktiv markieren' : 'Anzeige ist nicht mehr verfügbar'}
          </button>
        </form>

        {match.status !== 'CONTACTED' ? (
          <div className="row-wrap">
            {match.status !== 'FAVORITE' ? (
              <form action={favoriteListingAction}>
                <input type="hidden" name="candidateCaseId" value={candidateId} />
                <input type="hidden" name="listingId" value={l.id} />
                <button type="submit" className="btn sm">
                  ★ Favorit
                </button>
              </form>
            ) : null}
            {match.status !== 'REJECTED' ? (
              <form action={rejectListingAction} className="row" style={{ gap: 6 }}>
                <input type="hidden" name="candidateCaseId" value={candidateId} />
                <input type="hidden" name="listingId" value={l.id} />
                <input name="reason" className="input" placeholder="Grund (optional)" style={{ width: 150 }} />
                <button type="submit" className="btn sm danger">
                  Ablehnen
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
        </div>
      </div>

      {/* Always on screen, however far the text above has been scrolled: this
          is the one thing somebody opened the pane to do. */}
      <div className="pane-foot">
        <ContactFlow
          candidateCaseId={candidateId}
          listingId={l.id}
          listingUrl={l.rawUrl}
          message={message}
          status={match.status}
          alreadyContactedWarning={
            otherContact
              ? `Diese Wohnung wurde am ${formatDate(otherContact.contactedAt)} von ${
                  otherContact.user.name
                } bereits für Kandidat ${otherContact.candidateCase.reference} kontaktiert.`
              : null
          }
          contactEmail={l.contactEmail}
          contactPhone={l.contactPhone}
          contactName={l.contactName}
          sendingEnabled={sendingEnabled}
        />
      </div>
    </aside>
  );
}


/**
 * Freshness plus the arrival-vs-availability maths, including what a bridge
 * would cost. Shown for every listing so a great flat with a late start date
 * is a priced decision rather than a silent rejection.
 */
function TimingBlock({
  listing,
  arrival,
  freshnessSettings,
  bridging,
  liveness,
}: {
  listing: DetailMatch['listing'];
  arrival: Date | null;
  freshnessSettings: FreshnessSettings;
  bridging: BridgingSettings;
  liveness: LivenessPolicy;
}) {
  const fresh = evaluateFreshness(
    {
      firstSeenAt: listing.postedAt ?? listing.importedAt,
      lastSeenAt: listing.postedAt ? null : listing.lastSeenAt,
      expired: listing.expired,
    },
    freshnessSettings,
  );
  const band = bandOf(listing, liveness);
  const signals = Array.isArray(listing.livenessSignals)
    ? (listing.livenessSignals as LivenessSignal[])
    : [];
  const timing = evaluateMoveInTiming(
    listing.availableFrom,
    arrival,
    listing.effectiveMonthlyCents,
    bridging,
  );
  const firstPeriod = firstPeriodCostCents(timing, listing.effectiveMonthlyCents);
  const needsBridge = timing.verdict === 'BRIDGE_NEEDED' || timing.verdict === 'BRIDGE_TOO_LONG';

  return (
    <div className="stack-sm">
      <div className="row-wrap">
        <span className={`badge ${fresh.state === 'NEW' ? 'success' : fresh.state === 'STALE' ? 'warning' : ''}`}>
          Anzeige: {fresh.label}
        </span>
        {listing.postedAt ? (
          <span className="chip" title={listing.postedAtLabel ?? undefined}>
            {listing.postedAtLabel ?? `Inseriert ${formatDate(listing.postedAt)}`}
          </span>
        ) : (
          <span className="chip subtle">Kein Einstelldatum auf der Seite</span>
        )}
        {listing.expired ? (
          <span className="badge danger">
            Abgelaufen{listing.expiredBySystem ? ' (automatisch erkannt)' : ''}
          </span>
        ) : null}
      </div>

      {/* What the text detector read, and how sure it is. Shown as evidence
          rather than as a verdict, because it is a reading of prose and a
          colleague opening the ad is the final word. */}
      <div className="row-wrap small">
        <span
          className={`badge ${
            band === 'CONFIRMED' ? 'success' : band === 'DEAD' ? 'danger' : band === 'LIMBO' ? 'warning' : ''
          }`}
        >
          Textprüfung: {describeBand(band, listing.onlineConfidence)}
        </span>
        {listing.lastCheckedAt ? (
          <span className="subtle">zuletzt {formatDate(listing.lastCheckedAt)}</span>
        ) : null}
        {listing.lastCheckStatus === 'BLOCKED' ? (
          <span className="subtle">Portal blockiert das Auslesen</span>
        ) : null}
      </div>
      {listing.lastCheckReason ? (
        <p className="small subtle">{listing.lastCheckReason}</p>
      ) : null}
      {signals.length > 0 ? (
        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>
            Woran das erkannt wurde ({signals.length})
          </summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {signals.map((s, i) => (
              <li key={i} className="small subtle">
                {s.side === 'GONE' ? '−' : s.side === 'ALIVE' ? '+' : '?'} {s.label}{' '}
                ({Math.round(s.weight * 100)} %)
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {band === 'LIMBO' ? (
        <p className="small subtle">
          Die Seite war nicht eindeutig zu lesen. Die Anzeige bleibt bewusst sichtbar — bitte einmal
          öffnen und prüfen.
        </p>
      ) : null}
      <form action={checkListingNowAction}>
        <input type="hidden" name="listingId" value={listing.id} />
        <button type="submit" className="btn sm">
          Jetzt prüfen, ob die Anzeige noch online ist
        </button>
      </form>

      {arrival ? (
        <div className={`callout ${needsBridge ? 'warning' : 'success'}`}>
          <span className="callout-icon" aria-hidden>
            {needsBridge ? '!' : '✓'}
          </span>
          <div className="stack-sm" style={{ gap: 4 }}>
            <div>
              <strong>
                Frei ab {listing.availableFrom ? formatDate(listing.availableFrom) : 'unbekannt'}
              </strong>{' '}
              · Ankunft {formatDate(arrival)}
            </div>
            {needsBridge ? (
              <>
                <div className="small">
                  {timing.bridgeNights} Nächte Zwischenunterkunft ×{' '}
                  {formatEuroCents(bridging.nightlyRateCents)} ={' '}
                  <strong>{formatEuroCents(timing.bridgeCostCents)}</strong>
                </div>
                {firstPeriod != null ? (
                  <div className="small">
                    Erste Periode gesamt: {formatEuroCents(firstPeriod)} (Überbrückung + erste Monatsmiete)
                  </div>
                ) : null}
                {timing.verdict === 'BRIDGE_TOO_LONG' ? (
                  <div className="small">
                    Über {bridging.maxBridgeNights} Nächte — meist teurer als eine andere Wohnung.
                  </div>
                ) : null}
              </>
            ) : (
              <div className="small">{timing.label}</div>
            )}
          </div>
        </div>
      ) : (
        <p className="small subtle">
          Kein Ankunftsdatum im Suchprofil — ohne das kann die App keine Terminlücke berechnen.
        </p>
      )}
    </div>
  );
}
