import { describe, expect, it } from 'vitest';
import { parseListing } from '@/domain/parser';

function p(description: string, title = 'Testanzeige') {
  return parseListing({ title, description });
}

describe('parser: furnishing', () => {
  it('detects vollmöbliert (with adjective ending)', () => {
    const f = p('Charmantes vollmöbliertes Apartment im Zentrum, 40 m².');
    expect(f.furnishing).toBe('FULLY_FURNISHED');
  });

  it('detects komplett möbliert as fully furnished', () => {
    const f = p('Diese Wohnung ist komplett möbliert und sofort bezugsfertig.');
    expect(f.furnishing).toBe('FULLY_FURNISHED');
  });

  it('detects möbliert (bare) as furnished', () => {
    const f = p('Schöne möblierte Zwei-Zimmer-Wohnung mit Balkon.');
    expect(f.furnishing).toBe('FURNISHED');
  });

  it('detects teilmöbliert', () => {
    const f = p('Die Wohnung wird teilmöbliert übergeben — Küche und Schlafzimmer möbliert.');
    expect(f.furnishing).toBe('PARTIALLY_FURNISHED');
  });

  it('nicht möbliert wins over any furnished mention', () => {
    const f = p('Wohnung ist nicht möbliert, obwohl im Titel „möbliert" stand.');
    expect(f.furnishing).toBe('UNFURNISHED');
  });

  it('unmöbliert is treated as unfurnished', () => {
    const f = p('Unmöbliertes Apartment mit Einbauküche.');
    expect(f.furnishing).toBe('UNFURNISHED');
  });

  it('EBK alone does NOT mean furnished', () => {
    const f = p('Zwei-Zimmer-Wohnung mit moderner EBK, Balkon und Aufzug.');
    expect(f.furnishing).toBe('UNKNOWN');
    expect(f.fittedKitchen).toBe('YES');
  });

  it('Einbauküche alone does not imply furnished', () => {
    const f = p('Wohnung mit Einbauküche und Parkettboden.');
    expect(f.furnishing).toBe('UNKNOWN');
    expect(f.fittedKitchen).toBe('YES');
  });

  it('Möbelübernahme is its own state and extracts Ablöse', () => {
    const f = p('Wohnung mit Möbelübernahme gegen Ablöse in Höhe von 2.500 €.');
    expect(f.furnishing).toBe('FURNITURE_TAKEOVER');
    expect(f.abloeseCents).toBe(250000);
    expect(f.warnings.some((w) => w.includes('Ablöse'))).toBe(true);
  });
});

describe('parser: costs', () => {
  it('extracts Warmmiete and marks total as complete', () => {
    const f = p('Warmmiete 780,00 € inkl. Nebenkosten und Heizung.');
    expect(f.warmMieteCents).toBe(78000);
    expect(f.effectiveMonthlyCents).toBe(78000);
    expect(f.monthlyTotalComplete).toBe(true);
  });

  it('extracts Kaltmiete only, marks total as incomplete', () => {
    const f = p('Kaltmiete 700,00 € — Nebenkosten laut Angebot.');
    expect(f.kaltMieteCents).toBe(70000);
    expect(f.warmMieteCents).toBeNull();
    expect(f.monthlyTotalComplete).toBe(false);
    expect(f.warnings.some((w) => w.includes('Warmmiete unbekannt'))).toBe(true);
  });

  it('adds Kaltmiete + Nebenkosten + Heizkosten into effective monthly', () => {
    const f = p('Kaltmiete 620,00 €. Nebenkosten 120,00 €. Heizkosten 60,00 €.');
    expect(f.kaltMieteCents).toBe(62000);
    expect(f.nebenkostenCents).toBe(12000);
    expect(f.heizkostenCents).toBe(6000);
    expect(f.effectiveMonthlyCents).toBe(80000);
    expect(f.monthlyTotalComplete).toBe(true);
  });

  it('parses German thousands format 1.050,00', () => {
    const f = p('Warmmiete 1.050,00 € pro Monat.');
    expect(f.warmMieteCents).toBe(105000);
  });

  it('does not confuse deposit with rent', () => {
    const f = p('Warmmiete 780,00 €. Kaution 2.340 €.');
    expect(f.warmMieteCents).toBe(78000);
    expect(f.depositCents).toBe(234000);
  });

  it('detects provisionsfrei', () => {
    const f = p('Provisionsfrei zu vermieten, Warmmiete 800 €.');
    expect(f.provisionNote).toBe('provisionsfrei');
  });
});

describe('parser: rooms and space', () => {
  it('extracts rooms from the title', () => {
    const f = parseListing({
      title: '3-Zimmer-Wohnung in Heilbronn',
      description: 'Schöne Wohnung mit Balkon.',
    });
    expect(f.rooms).toBe(3);
  });

  it('extracts rooms with decimal (2,5)', () => {
    const f = p('Gemütliche 2,5-Zimmer-Wohnung, 65 m².');
    expect(f.rooms).toBe(2.5);
    expect(f.livingSpaceSqm).toBe(65);
  });

  it('accepts structured hints over parsed values', () => {
    const f = parseListing({
      title: '3-Zimmer',
      description: '3-Zimmer',
      structured: { rooms: 4, warmMieteCents: 95000 },
    });
    expect(f.rooms).toBe(4);
    expect(f.warmMieteCents).toBe(95000);
  });
});

describe('parser: restrictions', () => {
  it('detects WBS requirement', () => {
    const f = p('Wohnberechtigungsschein (WBS) zwingend erforderlich.');
    expect(f.wbsRequired).toBe('YES');
    expect(f.warnings.some((w) => w.includes('WBS'))).toBe(true);
  });

  it('detects Tauschwohnung', () => {
    const f = p('Wohnungstausch: biete 2 Zi, suche 3 Zi. Nur Tausch möglich.');
    expect(f.exchangeRequired).toBe('YES');
    expect(f.warnings.some((w) => w.includes('Tausch'))).toBe(true);
  });

  it('detects befristet and min duration', () => {
    const f = p('Befristeter Mietvertrag, Mindestmietdauer 6 Monate.');
    expect(f.fixedTerm).toBe('YES');
    expect(f.minDurationMonths).toBe(6);
  });

  it('detects Anmeldung möglich and Wohnungsgeberbestätigung', () => {
    const f = p('Anmeldung möglich, Wohnungsgeberbestätigung wird ausgestellt.');
    expect(f.anmeldungPossible).toBe('YES');
    expect(f.warnings.some((w) => w.includes('Wohnungsgeberbestätigung'))).toBe(true);
  });

  it('detects "keine Haustiere" as pets NO', () => {
    const f = p('Wohnung mit Balkon. Keine Haustiere.');
    expect(f.petsAllowed).toBe('NO');
  });

  it('detects "Haustiere erlaubt" as pets YES', () => {
    const f = p('Haustiere erlaubt, Balkon zum Innenhof.');
    expect(f.petsAllowed).toBe('YES');
  });

  it('flags SCHUFA/Einkommensnachweis', () => {
    const f = p('Bitte SCHUFA-Auskunft und Einkommensnachweis mitbringen.');
    expect(f.warnings.some((w) => w.includes('SCHUFA'))).toBe(true);
    expect(f.warnings.some((w) => w.includes('Einkommensnachweis'))).toBe(true);
  });
});

describe('parser: property type', () => {
  it('detects WG-Zimmer', () => {
    const f = p('Nettes WG-Zimmer in einer 3er-WG.');
    expect(f.propertyType).toBe('WG_ROOM');
  });

  it('detects a house', () => {
    const f = p('Einfamilienhaus mit Garten in ruhiger Lage.');
    expect(f.propertyType).toBe('HOUSE');
  });

  it('detects for-sale listings', () => {
    const f = p('Eigentumswohnung zu verkaufen, Kaufpreis 320.000 €.');
    expect(f.propertyType).toBe('FOR_SALE');
  });

  it('detects apartments', () => {
    const f = p('Charmante Mietwohnung in guter Lage.');
    expect(f.propertyType).toBe('APARTMENT');
  });

  it('detects Monteurzimmer as temporary', () => {
    const f = p('Monteurzimmer in Zentrumsnähe, kurzfristig verfügbar.');
    expect(f.propertyType).toBe('TEMPORARY');
  });
});
