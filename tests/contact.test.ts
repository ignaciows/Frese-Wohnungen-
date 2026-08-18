import { describe, expect, it } from 'vitest';
import {
  findContact,
  findContactName,
  findEmail,
  findPhone,
  hasDirectContact,
  normalisePhone,
  telHref,
} from '@/domain/contact';

describe('phone numbers in ad text', () => {
  it('reads the shapes landlords actually type', () => {
    const cases: Array<[string, string]> = [
      ['Tel. 0176 12345678', '+49 176 12345678'],
      ['Telefon: 0176/1234567', '+49 176 1234567'],
      ['Handy 0176-1234 5678', '+49 176 12345678'],
      ['Rufnummer (07131) 123456', '+49 7131 123456'],
      ['erreichbar unter +49 176 12345678', '+49 176 12345678'],
      ['Kontakt 0049 7131 987654', '+49 7131 987654'],
      ['Bitte nur per WhatsApp: 0151 23456789', '+49 151 23456789'],
      ['Rückruf unter 07131 / 98 76 54', '+49 7131 987654'],
    ];
    for (const [text, expected] of cases) {
      expect(findPhone(text), text).toBe(expected);
    }
  });

  it('does not invent numbers out of prices, sizes, dates or ids', () => {
    const noise = [
      'Warmmiete 1.250,00 € inkl. NK',
      '65 m² Wohnfläche, 3 Zimmer',
      'Frei ab 01.09.2026 bis 31.08.2027',
      'Anzeigen-ID 3123456789',
      'PLZ 74072 Heilbronn',
      'Kaution 3 Nettokaltmieten, 2.400 Euro',
      'IBAN DE02120300000000202051',
    ];
    for (const text of noise) {
      expect(findPhone(text), text).toBeNull();
    }
  });

  it('prefers the number that is actually labelled as one', () => {
    const text = 'Objektnummer 0987654321 im Exposé. Fragen? Telefon 0176 11223344.';
    expect(findPhone(text)).toBe('+49 176 11223344');
  });

  it('finds a number in the middle of running ad text', () => {
    const ad = `Schöne 2-Zimmer-Wohnung in Heilbronn, 62 m², Warmmiete 780 €.
      Frei ab 01.10.2026. Besichtigung nach Absprache, bitte melden Sie sich
      unter 07131 456789 oder per Mail.`;
    expect(findPhone(ad)).toBe('+49 7131 456789');
  });

  it('rejects placeholder and impossible numbers', () => {
    expect(normalisePhone('0000000000')).toBeNull();
    expect(normalisePhone('0123456789')).toBeNull();
    expect(normalisePhone('012345')).toBeNull();
    expect(normalisePhone('0176123456789012')).toBeNull();
  });

  it('builds a dialable link', () => {
    expect(telHref('+49 176 12345678')).toBe('tel:+4917612345678');
  });
});

describe('e-mail in ad text', () => {
  it('prefers an explicit mailto over anything in the prose', () => {
    expect(findEmail('schreiben an alt@example.org', 'Vermieter@Firma.de')).toBe('vermieter@firma.de');
  });

  it('finds an address in the text', () => {
    expect(findEmail('Anfragen bitte an wohnung@hausverwaltung-nord.de')).toBe('wohnung@hausverwaltung-nord.de');
  });

  it('ignores portal noise and image filenames', () => {
    expect(findEmail('noreply@immoscout24.de')).toBeNull();
    expect(findEmail('logo@2x.png')).toBeNull();
  });
});

describe('contact name', () => {
  it('takes a named contact person', () => {
    expect(findContactName('Ansprechpartner: Herr Müller')).toBe('Herr Müller');
    expect(findContactName('Kontakt Frau Schmidt-Weber, werktags')).toBe('Frau Schmidt-Weber');
  });

  it('falls back to a plain salutation', () => {
    expect(findContactName('Bitte wenden Sie sich an Frau Kaya.')).toBe('Frau Kaya');
  });

  it('takes a first name too, but only behind an explicit label', () => {
    expect(findContactName('Ansprechpartner: Herr Thomas Weber')).toBe('Herr Thomas Weber');
    // Without a label the next capitalised word is just the next sentence.
    expect(findContactName('Melden Sie sich bei Herr Weber. Besichtigung Samstag.')).toBe('Herr Weber');
  });

  it('keeps an academic title, which German adverts do print', () => {
    expect(findContactName('Ansprechpartner: Frau Dr. Klein')).toBe('Frau Dr. Klein');
  });

  it('stays empty when the ad names nobody', () => {
    expect(findContactName('Schöne Wohnung, provisionsfrei.')).toBeNull();
  });
});

describe('findContact', () => {
  it('reads everything in one pass', () => {
    const ad = `Nachmieter gesucht! Ansprechpartner: Herr Özdemir,
      Telefon 0176 55443322, E-Mail nachmieter@gmx.de. Frei ab 01.11.2026.`;
    const contact = findContact(ad);
    expect(contact).toEqual({
      phone: '+49 176 55443322',
      email: 'nachmieter@gmx.de',
      name: 'Herr Özdemir',
    });
    expect(hasDirectContact(contact)).toBe(true);
  });

  it('says plainly when there is no way in but the portal form', () => {
    const contact = findContact('Bitte ausschließlich über das Kontaktformular anfragen.');
    expect(contact).toEqual({ phone: null, email: null, name: null });
    expect(hasDirectContact(contact)).toBe(false);
  });
});
