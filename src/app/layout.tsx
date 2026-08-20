import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

/**
 * One real typeface instead of whatever the machine happens to have.
 *
 * The stack fell back to Segoe UI on Windows and Roboto on Android, so the
 * same screen was a different shape on every desk — and both are noticeably
 * tighter than the sizes here were tuned for. Inter is drawn for interfaces:
 * open apertures, unambiguous digits, and it holds together at the larger
 * sizes this app needs. Self-hosted by next/font, so there is no request to
 * Google at page load and nothing to block.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-ui',
});

export const metadata: Metadata = {
  title: 'Wohnungssucher',
  description: 'Interne Wohnungssuche für Frese Recruiting',
};

/**
 * Applies the saved theme before the first paint.
 *
 * It has to be inline and it has to run in the head: any later — in a
 * component, in an effect — and the browser has already painted the light
 * theme, which is the white flash you get on every page load of a dark site.
 * Falls back to whatever the operating system asks for when nothing is saved,
 * so the first visit is already right for people who work in the dark.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
