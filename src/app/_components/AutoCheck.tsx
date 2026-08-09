'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { maybeRunLivenessSweepAction } from '@/app/actions';

/**
 * Kicks off a small liveness sweep when someone opens the results list.
 *
 * Dead ads staying on screen because a cron was never configured is the exact
 * complaint this solves. The server action throttles itself, so this is safe to
 * mount on every page load; the component only reports when something changed.
 */
export function AutoCheck() {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await maybeRunLivenessSweepAction();
        if (cancelled || !r.ran) return;
        if (r.expired > 0) {
          setNote(`${r.expired} nicht mehr verfügbare Anzeige(n) wurden ausgeblendet.`);
          router.refresh();
        } else if (r.checked > 0) {
          router.refresh();
        }
      } catch {
        // A failed background check must never disturb the page.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

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
