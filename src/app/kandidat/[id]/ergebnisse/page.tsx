import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { Empty, Callout } from '@/app/_components/Shell';
import { AutoCheck } from '@/app/_components/AutoCheck';
import { WhatIfPanel } from '@/app/_components/WhatIfPanel';
import { ContactFlow } from '@/app/_components/ContactFlow';
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
import {
  bandOf,
  describeBand,
  livenessScoreFactor,
  type LivenessPolicy,
  type LivenessSignal,
} from '@/domain/liveness';
import { markListingExpiredAction, checkListingNowAction, setFollowUpAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'alle', label: 'Alle' },
  { key: 'zu-kontaktieren', label: 'Zu kontaktieren' },
  { key: 'favoriten', label: 'Favoriten' },
  { key: 'in-arbeit', label: 'In Arbeit' },
  { key: 'kontaktiert', label: 'Kontaktiert' },
  { key: 'abgelehnt', label: 'Abgelehnt' },
  { key: 'wiedervorlage', label: 'Wiedervorlage' },
  { key: 'zu-pruefen', label: 'Zu prüfen' },
  { key: 'abgelaufen', label: 'Abgelaufen' },
] as const;

/** Compatibility decides the group; the score only orders within it. */
const COMPAT_RANK: Record<string, number> = {
  COMPATIBLE: 0,
  NEAR_MATCH: 1,
  INSUFFICIENT_DATA: 2,
  INCOMPATIBLE: 3,
};

type MatchStatusValue = 'NEW' | 'FAVORITE' | 'IN_PROGRESS' | 'CONTACTED' | 'REJECTED' | 'EXPIRED';

function statusFilter(tab: string): { status?: MatchStatusValue | { in: MatchStatusValue[] } } {
  switch (tab) {
    case 'zu-kontaktieren':
      return { status: { in: ['NEW', 'FAVORITE'] } };
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
  const tab = sp.tab ?? 'alle';

  const [liveness, ageFilter] = await Promise.all([getLivenessSettings(), getAgeFilterSettings()]);

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
                  ? DEAD_LISTING
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
      listing: DEAD_LISTING,
    },
  });

  const followUpCount = await prisma.candidateListingMatch.count({
    where: { candidateCaseId: id, followUpAt: { not: null } },
  });

  const limboCount = await prisma.candidateListingMatch.count({
    where: { candidateCaseId: id, listing: limboListingFilter(liveness) },
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

  const matches: MatchRow[] = [...withinAge].sort((a, b) => {
    const rank = (COMPAT_RANK[a.compatibility] ?? 9) - (COMPAT_RANK[b.compatibility] ?? 9);
    if (rank !== 0) return rank;
    return effectiveScore(b, liveness) - effectiveScore(a, liveness);
  });

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
      <AutoCheck candidateCaseId={id} />
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
        {TABS.map((t) => (
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
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: selected ? 'minmax(0,1fr) 420px' : 'minmax(0,1fr)',
            gap: 20,
            alignItems: 'start',
          }}
        >
          <div className="card">
            {matches.map((m, i) => {
              const l = m.listing;
              const comp = COMPATIBILITY[m.compatibility] ?? COMPATIBILITY.INSUFFICIENT_DATA;
              const st = MATCH_STATUS[m.status] ?? MATCH_STATUS.NEW;
              // Colour follows the compatibility verdict, never a raw score
              // threshold — a green box next to an amber "Fast passend" badge
              // is a contradiction the reader has to resolve.
              const scoreCls =
                m.compatibility === 'COMPATIBLE'
                  ? 'good'
                  : m.compatibility === 'NEAR_MATCH'
                    ? 'mid'
                    : m.compatibility === 'INCOMPATIBLE'
                      ? 'bad'
                      : '';
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
                <Link
                  key={m.id}
                  href={`/kandidat/${id}/ergebnisse?tab=${tab}&listing=${l.id}`}
                  className={`listing ${selected?.listingId === l.id ? 'selected' : ''}`}
                >
                  <span className={`listing-score ${scoreCls}`}>
                    {m.compatibility === 'INCOMPATIBLE' ? '×' : Math.round(m.score)}
                  </span>
                  <span className="listing-main">
                    <span className="listing-title">
                      {i + 1}. {l.title}
                    </span>
                    {/* The three facts that decide whether to open an ad, big
                        enough to read at a glance. Everything else is either in
                        the detail pane or, if it is an "unknown", not shown at
                        all — a row that announces "Möblierung unbekannt" has
                        spent a line saying nothing. */}
                    <span className="listing-facts">
                      <span className="fact-price">
                        {l.effectiveMonthlyCents != null
                          ? `${formatEuroCents(l.effectiveMonthlyCents)}${l.monthlyTotalComplete ? '' : '*'}`
                          : 'Preis unbekannt'}
                      </span>
                      {l.rooms != null ? <span className="fact">{l.rooms} Zimmer</span> : null}
                      {l.livingSpaceSqm != null ? <span className="fact">{l.livingSpaceSqm} m²</span> : null}
                      {l.locationCity ? <span className="fact">{l.locationCity}</span> : null}
                    </span>

                    <span className="listing-meta">
                      <span className={`badge ${comp.tone}`}>{comp.short}</span>
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
              );
            })}
            {/* One footnote for the whole list. It used to be repeated on
                every Kleinanzeigen row, where it said the same thing eleven
                times and crowded out what differed between them. */}
            {matches.some((m) => !m.listing.monthlyTotalComplete) ? (
              <div className="listing-note">
                <strong>*</strong> Bei diesen Anzeigen nennt das Portal nur die Kaltmiete. Die
                Warmmiete liegt höher — meist 20–30 % — und steht erst in der Anzeige selbst.
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
function effectiveScore(
  match: { score: number; listing: { onlineConfidence: number | null; postedAt: Date | null } },
  policy: LivenessPolicy,
): number {
  return match.score * livenessScoreFactor(match.listing, policy);
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
    /// Only set when the ad itself publishes an address; decides whether the
    /// enquiry can be sent from here or has to go through the portal form.
    contactEmail: string | null;
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
    <aside className="stack" style={{ position: 'sticky', top: 76 }}>
      <div className="card">
        <div className="card-head">
          <div className="row-wrap">
            <span className={`badge ${comp.tone}`}>{comp.label}</span>
            <span className="badge brand">{Math.round(match.score)} Punkte</span>
          </div>
          <Link href={`/kandidat/${candidateId}/ergebnisse?tab=${tab}`} className="btn ghost sm">
            Schließen
          </Link>
        </div>
        <div className="card-body stack">
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
        </div>
      </div>

      <div className="card card-body stack">
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
          sendingEnabled={sendingEnabled}
        />

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
