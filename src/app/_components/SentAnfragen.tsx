import Link from 'next/link';

/**
 * Where the enquiries we sent actually are.
 *
 * "Wie viele Anfragen habe ich raus, und welche sind tot?" had no screen. The
 * counts existed — one on the overview, one in a tab — but not the thing that
 * decides what to do, which is *how long ago*. A landlord who has not answered
 * in three days is normal, in ten days is a lost cause, and those two look
 * identical in a list sorted by date.
 *
 * Four buckets, one bar, in the order they need attention.
 */

export interface SentAnfrage {
  contactedAt: Date;
  outcome: 'AWAITING' | 'POSITIVE' | 'NEGATIVE' | 'NEEDS_INFO';
}

/** After a week without an answer, chase. After two, it is gone. */
export const CHASE_AFTER_DAYS = 7;
export const GIVE_UP_AFTER_DAYS = 14;

type BucketKey = 'answered' | 'fresh' | 'chase' | 'lost';

const BUCKETS: Array<{ key: BucketKey; label: string; hint: string; tone: string }> = [
  { key: 'answered', label: 'Beantwortet', hint: 'Es kam eine Rückmeldung.', tone: 'success' },
  { key: 'fresh', label: 'Frisch', hint: 'Weniger als eine Woche unterwegs — abwarten.', tone: 'brand' },
  {
    key: 'chase',
    label: 'Nachfassen',
    hint: `Über ${CHASE_AFTER_DAYS} Tage ohne Antwort — einmal nachhaken.`,
    tone: 'warning',
  },
  {
    key: 'lost',
    label: 'Abschreiben',
    hint: `Über ${GIVE_UP_AFTER_DAYS} Tage ohne Antwort — erfahrungsgemäß vergeben.`,
    tone: 'danger',
  },
];

export function bucketOf(a: SentAnfrage, now: Date): BucketKey {
  if (a.outcome !== 'AWAITING') return 'answered';
  const days = Math.floor((now.getTime() - a.contactedAt.getTime()) / 86_400_000);
  if (days > GIVE_UP_AFTER_DAYS) return 'lost';
  if (days > CHASE_AFTER_DAYS) return 'chase';
  return 'fresh';
}

export function SentAnfragen({
  attempts,
  candidateId,
  now = new Date(),
}: {
  attempts: SentAnfrage[];
  candidateId: string;
  now?: Date;
}) {
  const counts: Record<BucketKey, number> = { answered: 0, fresh: 0, chase: 0, lost: 0 };
  for (const a of attempts) counts[bucketOf(a, now)]++;
  const total = attempts.length;

  return (
    <div className="card">
      <div className="card-head">
        <h2>Gesendete Anfragen</h2>
        <span className="badge brand">{total}</span>
      </div>
      <div className="card-body stack-sm">
        {total === 0 ? (
          <p className="small muted">
            Noch nichts rausgeschickt. Was du über „Öffnen &amp; Kontaktieren“ anschreibst, steht ab dann
            hier — mit dem Alter jeder Anfrage.
          </p>
        ) : (
          <>
            <div className="bucketbar" role="img" aria-label={`${total} Anfragen nach Alter`}>
              {BUCKETS.filter((b) => counts[b.key] > 0).map((b) => (
                <span
                  key={b.key}
                  className={`bucket-seg ${b.tone}`}
                  style={{ flexGrow: counts[b.key] }}
                  title={`${counts[b.key]} · ${b.hint}`}
                />
              ))}
            </div>
            <div className="buckets">
              {BUCKETS.map((b) => (
                <Link
                  key={b.key}
                  href={`/kandidat/${candidateId}/kontakte#${b.key}`}
                  className={`bucket ${b.tone} ${counts[b.key] === 0 ? 'is-zero' : ''}`}
                >
                  <span className="bucket-num">{counts[b.key]}</span>
                  <span className="bucket-label">{b.label}</span>
                  <span className="bucket-hint">{b.hint}</span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
