/**
 * Die Tagesliste — vor allem die eine Regel, die sie von der Kandidatenliste
 * unterscheidet: eine Telefonnummer steht oben, egal wie dringend der Rest ist.
 */

import { describe, expect, it } from 'vitest';
import { buildWorklist, describeWorklist, type CaseWork } from '@/domain/worklist';

function work(patch: Partial<CaseWork> = {}): CaseWork {
  return {
    candidateCaseId: 'c1',
    displayName: 'Tanvi Gupta',
    employer: null,
    priorityScore: 50,
    tier: 'NORMAL',
    daysUntilMoveIn: null,
    remainingContacts: 0,
    callable: 0,
    writable: 0,
    ...patch,
  };
}

describe('die Reihenfolge des Tages', () => {
  it('stellt eine Telefonnummer über jeden Punktestand', () => {
    // Der Kern der Liste. Wer anruft, hat in zehn Minuten eine Antwort; wer
    // schreibt, hat sie am Donnerstag. Das ist keine dringendere Aufgabe
    // derselben Art, sondern eine andere Art von Aufgabe.
    const list = buildWorklist([
      work({ candidateCaseId: 'brennt', priorityScore: 98, tier: 'CRITICAL', writable: 9 }),
      work({ candidateCaseId: 'nummer', priorityScore: 12, tier: 'LOW', callable: 1 }),
    ]);
    expect(list.call.map((i) => i.candidateCaseId)).toEqual(['nummer']);
    expect(list.write.map((i) => i.candidateCaseId)).toEqual(['brennt']);
  });

  it('sortiert innerhalb eines Blocks nach Dringlichkeit', () => {
    const list = buildWorklist([
      work({ candidateCaseId: 'mittel', priorityScore: 50, callable: 2 }),
      work({ candidateCaseId: 'hoch', priorityScore: 90, callable: 1 }),
      work({ candidateCaseId: 'niedrig', priorityScore: 10, callable: 5 }),
    ]);
    expect(list.call.map((i) => i.candidateCaseId)).toEqual(['hoch', 'mittel', 'niedrig']);
  });

  it('bleibt bei Gleichstand in derselben Reihenfolge', () => {
    // Sonst springt ein Fall zwischen zwei Aufrufen die Liste hoch und runter,
    // und jemand sucht, wo er hin ist.
    const cases = [
      work({ candidateCaseId: 'b', displayName: 'Bea', writable: 1 }),
      work({ candidateCaseId: 'a', displayName: 'Ana', writable: 1 }),
    ];
    expect(buildWorklist(cases).write.map((i) => i.displayName)).toEqual(['Ana', 'Bea']);
    expect(buildWorklist([...cases].reverse()).write.map((i) => i.displayName)).toEqual(['Ana', 'Bea']);
  });

  it('trennt Fälle ohne offene Wohnung ab, statt sie unten anzuhängen', () => {
    // Dort ist heute nichts zu holen — das ist kein „später dran", sondern ein
    // anderer Befund: es kommt nichts nach.
    const list = buildWorklist([work({ candidateCaseId: 'leer', priorityScore: 99 })]);
    expect(list.call).toEqual([]);
    expect(list.write).toEqual([]);
    expect(list.idle[0].action).toMatch(/Suchprofil/);
  });

  it('nennt die Zahl der Wohnungen, nicht nur die der Fälle', () => {
    const list = buildWorklist([
      work({ candidateCaseId: 'a', callable: 3, writable: 4 }),
      work({ candidateCaseId: 'b', writable: 2 }),
    ]);
    expect(list.totalCallable).toBe(3);
    expect(list.totalWritable).toBe(6);
    expect(list.call[0].action).toBe('3 Wohnungen mit Telefonnummer, dazu 4 zum Anschreiben');
  });

  it('sagt in der Einzahl „Wohnung"', () => {
    const list = buildWorklist([work({ callable: 1 })]);
    expect(list.call[0].action).toBe('1 Wohnung mit Telefonnummer');
  });
});

describe('warum ein Fall dort steht', () => {
  it('nennt die drückende Anreise', () => {
    const [item] = buildWorklist([work({ callable: 1, daysUntilMoveIn: 9 })]).call;
    expect(item.why).toMatch(/Anreise in 9 Tagen/);
  });

  it('sagt deutlich, wenn der Termin schon vorbei ist', () => {
    const [item] = buildWorklist([work({ writable: 1, daysUntilMoveIn: -4 })]).write;
    expect(item.why).toMatch(/seit 4 Tagen vorbei/);
  });

  it('nennt höchstens zwei Gründe', () => {
    // Eine Zeile mit fünf Begründungen wird nicht gelesen, und der dritte
    // Grund hat die Reihenfolge ohnehin nicht entschieden.
    const [item] = buildWorklist([
      work({ writable: 1, daysUntilMoveIn: 3, remainingContacts: 12, tier: 'CRITICAL' }),
    ]).write;
    expect(item.why!.split(' · ')).toHaveLength(2);
  });

  it('schweigt, wenn es nichts Besonderes zu sagen gibt', () => {
    const [item] = buildWorklist([work({ writable: 1, tier: 'NORMAL' })]).write;
    expect(item.why).toBeNull();
  });
});

describe('der Satz über den Tag', () => {
  it('zählt beide Blöcke', () => {
    const text = describeWorklist(
      buildWorklist([work({ candidateCaseId: 'a', callable: 2 }), work({ candidateCaseId: 'b', writable: 5 })]),
    );
    expect(text).toBe('2 Wohnungen mit Telefonnummer bei 1 Fall · 5 Wohnungen zum Anschreiben.');
  });

  it('feiert keinen Feierabend, wenn nur nichts nachkommt', () => {
    const text = describeWorklist(buildWorklist([work({ candidateCaseId: 'leer' })]));
    expect(text).toMatch(/kein Feierabend/);
  });

  it('bleibt still, wenn es gar keine Fälle gibt', () => {
    expect(describeWorklist(buildWorklist([]))).toBeNull();
  });
});
