import { describe, expect, it } from 'vitest';
import { weekLabel, weekStartOf } from '@/server/activity';

describe('week bucketing', () => {
  it('a Wednesday maps back to its Monday', () => {
    const ws = weekStartOf(new Date('2026-08-12T15:00:00Z')); // Wednesday
    expect(ws.toISOString().slice(0, 10)).toBe('2026-08-10');
  });

  it('a Monday maps to itself', () => {
    const ws = weekStartOf(new Date('2026-08-10T00:30:00Z'));
    expect(ws.toISOString().slice(0, 10)).toBe('2026-08-10');
  });

  it('a Sunday maps back to the Monday before it, not the next one', () => {
    const ws = weekStartOf(new Date('2026-08-16T23:59:00Z')); // Sunday
    expect(ws.toISOString().slice(0, 10)).toBe('2026-08-10');
  });

  it('crosses a month boundary correctly', () => {
    const ws = weekStartOf(new Date('2026-09-02T10:00:00Z')); // Wednesday
    expect(ws.toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('is stable — bucketing twice gives the same week', () => {
    const a = weekStartOf(new Date('2026-08-14T08:00:00Z'));
    const b = weekStartOf(new Date('2026-08-14T22:00:00Z'));
    expect(a.getTime()).toBe(b.getTime());
  });

  it('labels a week as a readable range', () => {
    expect(weekLabel(new Date('2026-08-10T00:00:00Z'))).toBe('10.08. – 16.08.');
  });
});
