import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { Empty, Callout } from '@/app/_components/Shell';
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
import { getFreshnessSettings, getBridgingSettings } from '@/server/settings';
import { markListingExpiredAction, checkListingNowAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'alle', label: 'Alle' },
  { key: 'zu-kontaktieren', label: 'Zu kontaktieren' },
  { key: 'favoriten', label: 'Favoriten' },
  { key: 'in-arbeit', label: 'In Arbeit' },
  { key: 'kontaktiert', label: 'Kontaktiert' },
  { key: 'abgelehnt', label: 'Abgelehnt' },
  { key: 'abgelaufen', label: 'Abgelaufen' },
] as const;

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

  const [matchList, counts, message, profile, freshnessSettings, bridging] = await Promise.all([
    prisma.candidateListingMatch.findMany({
      where: {
        candidateCaseId: id,
        ...statusFilter(tab),
        // Expired ads only show in their own tab, so the working list stays trustworthy.
        listing: tab === 'abgelaufen' ? { expired: true } : { expired: false },
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
    where: { candidateCaseId: id, listing: { expired: true } },
  });

  type MatchRow = (typeof matchList)[number];
  const matches: MatchRow[] = matchList;

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
      case 'abgelaufen':
        return expiredCount;
      default:
        return 0;
    }
  };

  const selected = sp.listing ? matches.find((m) => m.listingId === sp.listing) ?? null : null;
  const totalAll = counts.reduce((n, c) => n + c._count, 0);

  return (
    <div className="stack">
      {sp.error ? (
        <Callout tone="danger">
          {sp.error === 'ALREADY_CONTACTED_SAME_CANDIDATE'
            ? 'Diese Wohnung wurde für diesen Kandidaten bereits kontaktiert — ein zweiter Kontakt ist gesperrt.'
            : sp.error === 'ALREADY_CONTACTED_OTHER_CANDIDATE'
              ? 'Achtung: Diese Wohnung wurde bereits für einen anderen Kandidaten kontaktiert.'
              : sp.error}
        </Callout>
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
            Die App durchsucht die Portale nicht selbst. Öffne eine Quelle, suche dort mit dem angezeigten
            Rezept und importiere passende Anzeigen — danach erscheinen sie hier bewertet und sortiert.
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
              const scoreCls =
                m.compatibility === 'INCOMPATIBLE'
                  ? 'bad'
                  : m.score >= 70
                    ? 'good'
                    : m.score >= 45
                      ? 'mid'
                      : '';
              const reasons = Array.isArray(m.reasons) ? (m.reasons as string[]) : [];
              const fresh = evaluateFreshness(
                { firstSeenAt: l.importedAt, lastSeenAt: l.lastSeenAt, expired: l.expired },
                freshnessSettings,
              );
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
                    <span className="listing-meta">
                      <span className={`badge ${comp.tone}`}>{comp.short}</span>
                      <span className="badge">{l.source.name}</span>
                      <span className="chip">{FURNISHING[l.furnishing]}</span>
                      <span className="chip">
                        {l.effectiveMonthlyCents != null
                          ? `${formatEuroCents(l.effectiveMonthlyCents)}${l.monthlyTotalComplete ? '' : ' *'}`
                          : 'Preis unbekannt'}
                      </span>
                      <span className="chip">{l.rooms != null ? `${l.rooms} Zi.` : 'Zi. ?'}</span>
                      {l.locationCity ? <span className="chip">{l.locationCity}</span> : null}
                      {l.lastCheckStatus === 'GONE' ? (
                        <span className="badge danger">Link tot</span>
                      ) : null}
                      {fresh.state === 'NEW' ? (
                        <span className="badge success">● Neu</span>
                      ) : fresh.state === 'STALE' ? (
                        <span className="badge warning">Älter — evtl. vergeben</span>
                      ) : null}
                      {timing.verdict === 'BRIDGE_NEEDED' || timing.verdict === 'BRIDGE_TOO_LONG' ? (
                        <span className="badge warning">
                          {timing.bridgeNights} Tage Lücke ≈ {formatEuroCents(timing.bridgeCostCents)}
                        </span>
                      ) : timing.verdict === 'READY_BEFORE_ARRIVAL' || timing.verdict === 'READY_ON_TIME' ? (
                        <span className="badge success">Rechtzeitig frei</span>
                      ) : null}
                    </span>
                    {reasons.length > 0 ? (
                      <span className="small muted truncate">{reasons.slice(0, 3).join(' · ')}</span>
                    ) : null}
                  </span>
                  <span className="listing-side">
                    <span className={`badge ${st.tone}`}>
                      {st.icon} {st.label}
                    </span>
                    {!l.monthlyTotalComplete ? (
                      <span className="small subtle">* Kosten unvollständig</span>
                    ) : null}
                    <span className="small subtle">{fresh.label}</span>
                  </span>
                </Link>
              );
            })}
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
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

interface DetailMatch {
  status: string;
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
}: {
  candidateId: string;
  match: DetailMatch;
  message: string;
  tab: string;
  arrival: Date | null;
  freshnessSettings: FreshnessSettings;
  bridging: BridgingSettings;
}) {
  const l = match.listing;

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
        />

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
}: {
  listing: DetailMatch['listing'];
  arrival: Date | null;
  freshnessSettings: FreshnessSettings;
  bridging: BridgingSettings;
}) {
  const fresh = evaluateFreshness(
    { firstSeenAt: listing.importedAt, lastSeenAt: listing.lastSeenAt, expired: listing.expired },
    freshnessSettings,
  );
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
        {listing.expired ? (
          <span className="badge danger">
            Abgelaufen{listing.expiredBySystem ? ' (automatisch erkannt)' : ''}
          </span>
        ) : null}
      </div>

      <div className="row-wrap small">
        {listing.lastCheckStatus ? (
          <span
            className={`badge ${
              listing.lastCheckStatus === 'ALIVE'
                ? 'success'
                : listing.lastCheckStatus === 'GONE'
                  ? 'danger'
                  : 'warning'
            }`}
          >
            Link-Prüfung: {listing.lastCheckStatus}
          </span>
        ) : (
          <span className="badge">Noch nicht geprüft</span>
        )}
        {listing.lastCheckedAt ? (
          <span className="subtle">zuletzt {formatDate(listing.lastCheckedAt)}</span>
        ) : null}
      </div>
      {listing.lastCheckReason ? (
        <p className="small subtle">{listing.lastCheckReason}</p>
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
