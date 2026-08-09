import { describe, expect, it } from 'vitest';
import {
  extractListings,
  parseAlertEmail,
  parseRecipient,
  routeFromRecipients,
  type RawEmail,
} from '@/domain/mail';

describe('recipient routing', () => {
  it('reads the candidate reference from a plus address', () => {
    const r = parseRecipient('wohnungen+CAND-2026-014@frese.de');
    expect(r.candidateReference).toBe('CAND-2026-014');
    expect(r.mailbox).toBe('wohnungen');
  });

  it('uppercases the reference so matching is case-insensitive', () => {
    expect(parseRecipient('post+cand-demo-01@x.de').candidateReference).toBe('CAND-DEMO-01');
  });

  it('returns null without a plus tag', () => {
    expect(parseRecipient('wohnungen@frese.de').candidateReference).toBeNull();
  });

  it('handles a malformed address without throwing', () => {
    expect(parseRecipient('not-an-address').candidateReference).toBeNull();
  });

  it('picks the first tagged recipient across headers', () => {
    const ref = routeFromRecipients(['noreply@portal.de', 'wohnungen+CAND-7@frese.de']);
    expect(ref).toBe('CAND-7');
  });
});

describe('listing extraction', () => {
  it('finds an ImmoScout24 expose link and its source', () => {
    const html = '<a href="https://www.immobilienscout24.de/expose/153627384">Schöne 2-Zimmer-Wohnung</a>';
    const r = extractListings(html);
    expect(r.sourceKey).toBe('immoscout24');
    expect(r.listings).toHaveLength(1);
    expect(r.listings[0].url).toContain('/expose/153627384');
    expect(r.listings[0].title).toBe('Schöne 2-Zimmer-Wohnung');
  });

  it('strips tracking parameters', () => {
    const html = '<a href="https://www.immobilienscout24.de/expose/1?utm_source=alert&utm_medium=mail">X</a>';
    const r = extractListings(html);
    expect(r.listings[0].url).not.toContain('utm_source');
  });

  it('deduplicates the same listing linked twice', () => {
    const html = `
      <a href="https://www.immobilienscout24.de/expose/999">Titel A</a>
      <a href="https://www.immobilienscout24.de/expose/999">Bild</a>`;
    expect(extractListings(html).listings).toHaveLength(1);
  });

  it('finds several distinct listings — the "2 new ads" case', () => {
    const html = `
      <a href="https://www.immobilienscout24.de/expose/111">Erste Wohnung in Heilbronn</a>
      <a href="https://www.immobilienscout24.de/expose/222">Zweite Wohnung in Heilbronn</a>`;
    const r = extractListings(html);
    expect(r.listings).toHaveLength(2);
  });

  it('recognises Kleinanzeigen links', () => {
    const r = extractListings('https://www.kleinanzeigen.de/s-anzeige/schoene-wohnung/1234567890');
    expect(r.sourceKey).toBe('kleinanzeigen');
  });

  it('recognises Immowelt links', () => {
    const r = extractListings('<a href="https://www.immowelt.de/expose/2abc-xyz">Wohnung</a>');
    expect(r.sourceKey).toBe('immowelt');
  });

  it('ignores generic call-to-action link text as a title', () => {
    const html = '<a href="https://www.immobilienscout24.de/expose/555">Jetzt ansehen</a>';
    expect(extractListings(html).listings[0].title).toBeNull();
  });

  it('returns nothing for a mail without listing links', () => {
    const r = extractListings('<p>Ihr Suchauftrag wurde gespeichert. <a href="https://portal.de/konto">Konto</a></p>');
    expect(r.listings).toHaveLength(0);
    expect(r.sourceKey).toBeNull();
  });

  it('handles HTML-escaped ampersands in URLs', () => {
    const html = '<a href="https://www.immobilienscout24.de/expose/77?a=1&amp;b=2">Wohnung mit Balkon</a>';
    const r = extractListings(html);
    expect(r.listings[0].url).not.toContain('&amp;');
  });

  it('does not swallow a trailing bracket into the URL', () => {
    const r = extractListings('Siehe (https://www.immobilienscout24.de/expose/88).');
    expect(r.listings[0].url).toMatch(/expose\/88$/);
  });
});

describe('full alert parsing', () => {
  const mail: RawEmail = {
    messageId: '<abc@portal.de>',
    from: 'noreply@immobilienscout24.de',
    recipients: ['wohnungen+CAND-DEMO-01@frese.de'],
    subject: '2 neue Angebote für Ihren Suchauftrag',
    html: `
      <a href="https://www.immobilienscout24.de/expose/111">2-Zimmer-Wohnung Heilbronn Süd</a>
      <a href="https://www.immobilienscout24.de/expose/222">3-Zimmer-Wohnung mit Balkon</a>`,
    text: null,
    receivedAt: new Date('2026-08-09T08:00:00Z'),
  };

  it('routes to the candidate and both listings', () => {
    const a = parseAlertEmail(mail);
    expect(a.candidateReference).toBe('CAND-DEMO-01');
    expect(a.sourceKey).toBe('immoscout24');
    expect(a.listings).toHaveLength(2);
  });

  it('falls back to the plain-text body when there is no HTML', () => {
    const a = parseAlertEmail({
      ...mail,
      html: null,
      text: 'Neu: https://www.immobilienscout24.de/expose/333',
    });
    expect(a.listings).toHaveLength(1);
    expect(a.listings[0].title).toBeNull();
  });

  it('reports no candidate when the address is not tagged', () => {
    const a = parseAlertEmail({ ...mail, recipients: ['wohnungen@frese.de'] });
    expect(a.candidateReference).toBeNull();
    // Listings are still found, so the log can explain what was missed.
    expect(a.listings).toHaveLength(2);
  });
});
