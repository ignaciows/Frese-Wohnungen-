import Link from 'next/link';
import { formatEuroCents } from '@/lib/money';

interface Match {
  compatibility: string;
  score: number;
  status: string;
  listing: {
    id: string;
    title: string;
    locationRaw: string;
    locationCity: string | null;
    locationPostal: string | null;
    furnishing: string;
    rooms: number | null;
    livingSpaceSqm: number | null;
    effectiveMonthlyCents: number | null;
    monthlyTotalComplete: boolean;
    warnings: string[];
    source: { name: string; integrationMode: string };
  };
  reasons: unknown;
}

interface Props {
  candidate: { id: string };
  matches: Match[];
  activeTab: string;
  selectedListingId: string | null;
}

const TABS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'Alle' },
  { key: 'favorites', label: 'Favoriten' },
  { key: 'to-contact', label: 'Zu kontaktieren' },
  { key: 'in-progress', label: 'In Bearbeitung' },
  { key: 'contacted', label: 'Kontaktiert' },
  { key: 'rejected', label: 'Abgelehnt' },
];

const COMPAT_META: Record<string, { color: string; icon: string; label: string }> = {
  COMPATIBLE: { color: 'var(--success)', icon: '●', label: 'Passend' },
  NEAR_MATCH: { color: 'var(--warning)', icon: '◐', label: 'Fast passend' },
  INSUFFICIENT_DATA: { color: 'var(--neutral)', icon: '?', label: 'Zu wenig Daten' },
  INCOMPATIBLE: { color: 'var(--danger)', icon: '✕', label: 'Nicht passend' },
};

const STATUS_META: Record<string, { className: string; label: string }> = {
  NEW: { className: 'status-new', label: 'Neu' },
  FAVORITE: { className: 'status-favorite', label: '★ Favorit' },
  IN_PROGRESS: { className: 'status-in-progress', label: 'In Bearbeitung' },
  CONTACTED: { className: 'status-contacted', label: '✓ Kontaktiert' },
  REJECTED: { className: 'status-rejected', label: 'Abgelehnt' },
  EXPIRED: { className: 'status-rejected', label: 'Abgelaufen' },
};

export function ResultsColumn({ candidate, matches, activeTab, selectedListingId }: Props) {
  return (
    <section style={{ display: 'grid', gap: 8 }}>
      <div className="card" style={{ padding: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/?case=${candidate.id}&tab=${t.key}`}
            className="btn small"
            style={{
              background: t.key === activeTab ? 'var(--accent)' : 'var(--card)',
              color: t.key === activeTab ? 'var(--accent-fg)' : 'inherit',
              borderColor: t.key === activeTab ? 'var(--accent)' : 'var(--border)',
            }}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {matches.length === 0 ? (
        <div className="card" style={{ padding: 20 }}>
          <p className="muted">Keine Anzeigen in diesem Bereich. Nutze die Quellen-Checkliste oder importiere manuell.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {matches.map((m) => {
            const cm = COMPAT_META[m.compatibility] ?? COMPAT_META.INSUFFICIENT_DATA;
            const sm = STATUS_META[m.status] ?? STATUS_META.NEW;
            const isSelected = m.listing.id === selectedListingId;
            const monthly =
              m.listing.effectiveMonthlyCents != null
                ? m.listing.monthlyTotalComplete
                  ? formatEuroCents(m.listing.effectiveMonthlyCents) + ' warm'
                  : formatEuroCents(m.listing.effectiveMonthlyCents) + ' (unklar)'
                : 'Miete unbekannt';
            return (
              <Link
                key={m.listing.id}
                href={`/?case=${candidate.id}&tab=${activeTab}&listing=${m.listing.id}`}
                className="card"
                style={{
                  padding: 12,
                  display: 'grid',
                  gap: 6,
                  borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                  outline: isSelected ? '2px solid color-mix(in oklab, var(--accent) 30%, transparent)' : 'none',
                  color: 'inherit',
                  textDecoration: 'none',
                }}
              >
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ color: cm.color, fontWeight: 700 }} title={cm.label}>
                    {cm.icon}
                  </span>
                  <strong>{m.listing.title}</strong>
                  <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
                    Score {Math.round(m.score)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
                  <span className="chip">{m.listing.source.name}</span>
                  <span className="chip">{formatFurnishing(m.listing.furnishing)}</span>
                  <span className="chip">{m.listing.rooms ?? '?'} Zi</span>
                  {m.listing.livingSpaceSqm != null ? (
                    <span className="chip">{m.listing.livingSpaceSqm} m²</span>
                  ) : null}
                  <span className="chip">{monthly}</span>
                  <span className="chip">
                    {[m.listing.locationPostal, m.listing.locationCity].filter(Boolean).join(' ') ||
                      m.listing.locationRaw ||
                      'Ort unbekannt'}
                  </span>
                  <span className={`chip ${sm.className}`}>{sm.label}</span>
                </div>
                {m.listing.warnings.length ? (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {m.listing.warnings.map((w, i) => (
                      <span key={i} className="chip approximate">
                        ! {w}
                      </span>
                    ))}
                  </div>
                ) : null}
                <ReasonList reasons={m.reasons} />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ReasonList({ reasons }: { reasons: unknown }) {
  const arr = Array.isArray(reasons) ? (reasons as string[]) : [];
  if (arr.length === 0) return null;
  return (
    <div className="muted" style={{ fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
      {arr.slice(0, 5).map((r, i) => (
        <span key={i}>{r}</span>
      ))}
    </div>
  );
}

function formatFurnishing(f: string): string {
  switch (f) {
    case 'FULLY_FURNISHED':
      return 'Vollmöbliert';
    case 'FURNISHED':
      return 'Möbliert';
    case 'PARTIALLY_FURNISHED':
      return 'Teilmöbliert';
    case 'FURNITURE_TAKEOVER':
      return 'Möbelübernahme';
    case 'UNFURNISHED':
      return 'Unmöbliert';
    default:
      return 'Möblierung ?';
  }
}
