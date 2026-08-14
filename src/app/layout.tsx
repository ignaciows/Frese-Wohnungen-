import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Frese Wohnung',
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
    <html lang="de">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
