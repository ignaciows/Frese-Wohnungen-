'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { maybeRunLivenessSweepAction, maybeRunDiscoverySweepAction } from '@/app/actions';

/**
 * Brings the list up to date when somebody opens it.
 *
 * Two passes, in this order and for this reason: the link check runs first and
 * is fast, so dead ads disappear immediately; the search for new ones runs
 * second and takes longer, because a stale list is the complaint and a
 * slightly late arrival is not.
 *
 * Both server actions throttle themselves, so mounting this on every page load
 * costs nothing when a sweep has just run. Neither can disturb the page: a
 * failure is swallowed and the list simply stays as it was.
 */
export function AutoCheck({ candidateCaseId }: { candidateCaseId?: string } = {}) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const parts: string[] = [];
      let changed = false;

      try {
        // Scoped to this candidate so the ads actually on screen are the ones
        // re-read, rather than whatever was oldest across the database.
        const liveness = await maybeRunLivenessSweepAction(candidateCaseId);
        if (cancelled) return;
        if (liveness.ran && liveness.expired > 0) {
          parts.push(`${liveness.expired} nicht mehr verfügbare Anzeige(n) ausgeblendet`);
          changed = true;
        } else if (liveness.ran && liveness.checked > 0) {
          changed = true;
        }
        if (liveness.ran && liveness.limbo > 0) {
          parts.push(`${liveness.limbo} unklar — im Reiter „Zu prüfen"`);
        }
      } catch {
        // A failed background check must never disturb the page.
      }

      try {
        setBusy(true);
        const discovery = await maybeRunDiscoverySweepAction();
        if (cancelled) return;
        if (discovery.ran) {
          if (discovery.created > 0) parts.push(`${discovery.created} neue Anzeige(n) gefunden`);
          if (discovery.retired > 0) parts.push(`${discovery.retired} verschwundene Anzeige(n) entfernt`);
          if (discovery.created > 0 || discovery.retired > 0) changed = true;
          // Say so when a portal turned us away, rather than letting an empty
          // list imply the market is empty.
          if (discovery.sourcesBlocked > 0) {
            parts.push(`${discovery.sourcesBlocked} Quelle(n) blockieren automatische Abrufe`);
          }
        }
      } catch {
        // Same: discovery is best-effort.
      } finally {
        if (!cancelled) setBusy(false);
      }

      if (cancelled) return;
      if (parts.length > 0) setNote(parts.join(' · ') + '.');
      if (changed) router.refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [router, candidateCaseId]);

  if (busy && !note) {
    return (
      <div className="callout info">
        <span className="callout-icon" aria-hidden>
          ⟳
        </span>
        <div>Quellen werden auf neue Anzeigen geprüft …</div>
      </div>
    );
  }

  if (!note) return null;
  return (
    <div className="callout success">
      <span className="callout-icon" aria-hidden>
        ✓
      </span>
      <div>{note}</div>
    </div>
  );
}
