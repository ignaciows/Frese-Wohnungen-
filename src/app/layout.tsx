import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Frese Wohnung',
  description: 'Interne Wohnungssuche für Frese Recruiting',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
