import { formatEuroCents } from '@/lib/money';
import {
  claimListingAction,
  confirmContactAction,
  favoriteListingAction,
  markRegisteredAction,
  rejectListingAction,
} from '../actions';
import { CopyForSystemPanel } from './CopyForSystemPanel';
import { OpenAndContactButton } from './OpenAndContactButton';

interface Props {
  candidate: { id: string; applicationMessage: { body: string } | null };
  match: {
    compatibility: string;
    score: number;
    breakdown: unknown;
    reasons: unknown;
    blockers: unknown;
    status: string;
    listing: {
      id: string;
      title: string;
      canonicalUrl: string;
      rawUrl: string;
      locationRaw: string;
      locationCity: string | null;
      locationPostal: string | null;
      descriptionRaw: string;
      furnishing: string;
      propertyType: string;
      rooms: number | null;
      livingSpaceSqm: number | null;
      warmMieteCents: number | null;
      kaltMieteCents: number | null;
      nebenkostenCents: number | null;
      heizkostenCents: number | null;
      depositCents: number | null;
      abloeseCents: number | null;
      effectiveMonthlyCents: number | null;
      monthlyTotalComplete: boolean;
      warnings: string[];
      source: { name: string; integrationMode: string };
      facts: Array<{ key: string; origin: string; evidence: string | null; confidence: number; isOverride: boolean }>;
      claims: Array<{ user: { name: string }; expiresAt: Date }>;
      contactAttempts: Array<{
        id: string;
        contactedAt: Date;
        user: { name: string };
        candidateCase: { id: string; reference: string; displayName: string };
        systemTransfer: {
          objectLabel: string;
          link: string;
          location: string;
          registeredAt: Date | null;
        } | null;
      }>;
      duplicateLinks: Array<{
        confidence: number;
        reasons: unknown;
        group: {
          members: Array<{
            listing: { id: string; title: string } & { source?: { name: string } | null };
          }>;
        };
      }>;
    };
  } | null;
}

export function DetailPanel({ candidate, match }: Props) {
  if (!match) {
    return (
      <aside className="card" style={{ padding: 16 }}>
        <p className="muted">Keine Anzeige ausgewählt.</p>
      </aside>
    );
  }
  const l = match.listing;
  const alreadyContactedByThisCase = l.contactAttempts.some((a) => a.candidateCase.id === candidate.id);
  const otherCaseContact = l.contactAttempts.find((a) => a.candidateCase.id !== candidate.id);
  const activeClaim = l.claims[0];
  const contactForThisCase = l.contactAttempts.find((a) => a.candidateCase.id === candidate.id);
  const messageBody = candidate.applicationMessage?.body ?? '';

  return (
    <aside className="card" style={{ padding: 12, display: 'grid', gap: 12 }}>
      <div>
        <h3 style={{ margin: 0 }}>{l.title}</h3>
        <div className="muted" style={{ fontSize: 12 }}>
          {l.source.name} · {l.source.integrationMode.replace('_', ' ')} ·{' '}
          {[l.locationPostal, l.locationCity].filter(Boolean).join(' ') || l.locationRaw}
        </div>
      </div>

      {/* Duplicate warnings */}
      {l.duplicateLinks.length > 0 ? (
        <div
          className="card"
          style={{
            padding: 8,
            borderColor: 'var(--warning)',
            background: 'color-mix(in oklab, var(--warning) 8%, transparent)',
            fontSize: 12,
          }}
        >
          <strong>Mögliche Duplikate</strong>
          <ul style={{ margin: '4px 0 0 16px' }}>
            {l.duplicateLinks.flatMap((dl, i) =>
              dl.group.members
                .filter((m) => m.listing.id !== l.id)
                .map((m, j) => (
                  <li key={`${i}-${j}`}>
                    {m.listing.title} ({m.listing.source?.name ?? '—'})
                    <span className="muted"> · Konfidenz {Math.round(dl.confidence * 100)}%</span>
                  </li>
                )),
            )}
          </ul>
        </div>
      ) : null}

      {otherCaseContact && !alreadyContactedByThisCase ? (
        <div
          className="card"
          style={{
            padding: 8,
            borderColor: 'var(--danger)',
            background: 'color-mix(in oklab, var(--danger) 8%, transparent)',
            fontSize: 12,
          }}
        >
          <strong>Achtung:</strong> Anzeige wurde bereits für Kandidat{' '}
          <strong>{otherCaseContact.candidateCase.reference}</strong> von {otherCaseContact.user.name} kontaktiert
          ({otherCaseContact.contactedAt.toLocaleString('de-DE')}).
        </div>
      ) : null}

      {alreadyContactedByThisCase ? (
        <div
          className="card"
          style={{
            padding: 8,
            borderColor: 'var(--success)',
            background: 'color-mix(in oklab, var(--success) 10%, transparent)',
            fontSize: 12,
          }}
        >
          ✓ Für diesen Kandidaten bereits kontaktiert.
        </div>
      ) : null}

      {activeClaim ? (
        <div className="muted" style={{ fontSize: 12 }}>
          In Bearbeitung von {activeClaim.user.name} bis {activeClaim.expiresAt.toLocaleTimeString('de-DE')}
        </div>
      ) : null}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <OpenAndContactButton
          messageBody={messageBody}
          openUrl={l.rawUrl}
          candidateCaseId={candidate.id}
          listingId={l.id}
        />
        <form action={favoriteListingAction}>
          <input type="hidden" name="candidateCaseId" value={candidate.id} />
          <input type="hidden" name="listingId" value={l.id} />
          <button type="submit" className="btn small">
            ★ Favorit
          </button>
        </form>
        <form action={claimListingAction}>
          <input type="hidden" name="candidateCaseId" value={candidate.id} />
          <input type="hidden" name="listingId" value={l.id} />
          <button type="submit" className="btn small">
            Beanspruchen
          </button>
        </form>
        <form action={confirmContactAction}>
          <input type="hidden" name="candidateCaseId" value={candidate.id} />
          <input type="hidden" name="listingId" value={l.id} />
          <button type="submit" className="btn small primary">
            ✓ Kontakt bestätigen
          </button>
        </form>
        <form action={rejectListingAction}>
          <input type="hidden" name="candidateCaseId" value={candidate.id} />
          <input type="hidden" name="listingId" value={l.id} />
          <input
            type="text"
            name="reason"
            placeholder="Grund (optional)"
            className="input small"
            style={{ width: 150, display: 'inline-block' }}
          />
          <button type="submit" className="btn small danger">
            Ablehnen
          </button>
        </form>
      </div>

      {/* Facts table */}
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <tbody>
          <FactRow label="Objekttyp" value={l.propertyType} />
          <FactRow label="Möblierung" value={l.furnishing} />
          <FactRow label="Zimmer" value={l.rooms} />
          <FactRow label="Wohnfläche" value={l.livingSpaceSqm != null ? `${l.livingSpaceSqm} m²` : null} />
          <FactRow
            label="Warmmiete"
            value={l.warmMieteCents != null ? formatEuroCents(l.warmMieteCents) : null}
          />
          <FactRow
            label="Kaltmiete"
            value={l.kaltMieteCents != null ? formatEuroCents(l.kaltMieteCents) : null}
          />
          <FactRow
            label="Nebenkosten"
            value={l.nebenkostenCents != null ? formatEuroCents(l.nebenkostenCents) : null}
          />
          <FactRow
            label="Heizkosten"
            value={l.heizkostenCents != null ? formatEuroCents(l.heizkostenCents) : null}
          />
          <FactRow
            label="Kaution"
            value={l.depositCents != null ? formatEuroCents(l.depositCents) : null}
          />
          <FactRow
            label="Ablöse"
            value={l.abloeseCents != null ? formatEuroCents(l.abloeseCents) : null}
          />
          <FactRow
            label="Gesamt monatlich (bestätigt)"
            value={
              l.effectiveMonthlyCents != null
                ? l.monthlyTotalComplete
                  ? formatEuroCents(l.effectiveMonthlyCents)
                  : `${formatEuroCents(l.effectiveMonthlyCents)} (unklar)`
                : null
            }
          />
        </tbody>
      </table>

      {l.warnings.length ? (
        <div style={{ display: 'grid', gap: 4 }}>
          <strong style={{ fontSize: 13 }}>Warnungen</strong>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {l.warnings.map((w, i) => (
              <li key={i} style={{ color: 'var(--warning)' }}>
                {w}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ScoreBreakdown breakdown={match.breakdown} reasons={match.reasons} />

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 13 }}>Beweisstellen (Parser)</summary>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, marginTop: 6 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Feld</th>
              <th style={{ textAlign: 'left' }}>Herkunft</th>
              <th style={{ textAlign: 'left' }}>Beleg</th>
              <th style={{ textAlign: 'right' }}>Konf.</th>
            </tr>
          </thead>
          <tbody>
            {l.facts.map((f, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '2px 4px' }}>{f.key}</td>
                <td style={{ padding: '2px 4px' }}>{f.origin}{f.isOverride ? ' (manuell)' : ''}</td>
                <td className="muted" style={{ padding: '2px 4px' }}>{f.evidence ?? '—'}</td>
                <td style={{ padding: '2px 4px', textAlign: 'right' }}>{Math.round(f.confidence * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 13 }}>Anzeigen-Text (importiert)</summary>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
            fontSize: 12,
            marginTop: 6,
            background: 'color-mix(in oklab, var(--muted) 10%, transparent)',
            padding: 8,
            borderRadius: 6,
            maxHeight: 240,
            overflow: 'auto',
          }}
        >
          {l.descriptionRaw}
        </pre>
      </details>

      {contactForThisCase?.systemTransfer ? (
        <CopyForSystemPanel
          transfer={contactForThisCase.systemTransfer}
          contactAttemptId={contactForThisCase.id}
          markAction={markRegisteredAction}
        />
      ) : null}
    </aside>
  );
}

function FactRow({ label, value }: { label: string; value: string | number | null }) {
  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '4px 6px', color: 'var(--muted)', width: '45%' }}>{label}</td>
      <td style={{ padding: '4px 6px' }}>{value == null || value === '' || value === 'UNKNOWN' ? '—' : value}</td>
    </tr>
  );
}

function ScoreBreakdown({ breakdown, reasons }: { breakdown: unknown; reasons: unknown }) {
  const b = breakdown as { total: number; furnishing: number; rooms: number; budget: number; commute: number; completeness: number } | null;
  const rs = Array.isArray(reasons) ? (reasons as string[]) : [];
  if (!b) return null;
  return (
    <details open>
      <summary style={{ cursor: 'pointer', fontSize: 13 }}>Bewertung ({b.total})</summary>
      <div style={{ display: 'grid', gap: 4, marginTop: 6, fontSize: 12 }}>
        <ScoreBar label="Möblierung" pct={b.furnishing} />
        <ScoreBar label="Zimmer" pct={b.rooms} />
        <ScoreBar label="Budget" pct={b.budget} />
        <ScoreBar label="Anfahrt" pct={b.commute} />
        <ScoreBar label="Datenqualität" pct={b.completeness} />
        {rs.length ? (
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {rs.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

function ScoreBar({ label, pct }: { label: string; pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 40px', alignItems: 'center', gap: 6 }}>
      <span className="muted">{label}</span>
      <div
        style={{
          height: 6,
          background: 'color-mix(in oklab, var(--muted) 15%, transparent)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: '100%',
            background:
              clamped >= 70 ? 'var(--success)' : clamped >= 40 ? 'var(--warning)' : 'var(--danger)',
          }}
        />
      </div>
      <span style={{ textAlign: 'right' }}>{clamped}</span>
    </div>
  );
}
