'use client';

import { useEffect, useState } from 'react';

/**
 * Day or night, remembered.
 *
 * The choice is written to `data-theme` on the root element and to
 * localStorage. It is *applied* by a tiny script in the document head, before
 * anything paints — see layout.tsx. Doing it here instead would show the light
 * theme for one frame on every load, which is the flash everybody notices and
 * nobody can explain.
 *
 * The button renders after mount for the same reason: on the server there is no
 * way to know which theme the browser will apply, and rendering the wrong icon
 * first is the same flash in miniature.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    setTheme(current);
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Private mode, or storage full: the theme still applies for this visit.
    }
    setTheme(next);
  }

  if (theme === null) {
    // Same footprint as the real button, so the header does not jump.
    return <span className="theme-toggle" aria-hidden style={{ visibility: 'hidden' }} />;
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      title={theme === 'dark' ? 'Zur Tagansicht wechseln' : 'Zur Nachtansicht wechseln'}
      aria-label={theme === 'dark' ? 'Tagansicht' : 'Nachtansicht'}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
