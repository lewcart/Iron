import { describe, it, expect } from 'vitest';
import { photoCadenceState } from './photo-cadence';

const TODAY = new Date(2026, 4, 3); // 2026-05-03 (May = month index 4)

function daysAgo(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('photoCadenceState', () => {
  it('returns no-photo-ever when input is null', () => {
    expect(photoCadenceState(null, TODAY)).toEqual({ status: 'no-photo-ever', dueIn: 0 });
  });

  it('returns no-photo-ever for malformed date input', () => {
    expect(photoCadenceState('not-a-date', TODAY)).toEqual({ status: 'no-photo-ever', dueIn: 0 });
    expect(photoCadenceState('', TODAY)).toEqual({ status: 'no-photo-ever', dueIn: 0 });
  });

  it('fresh when 10 days ago', () => {
    const r = photoCadenceState(daysAgo(10), TODAY);
    expect(r.status).toBe('fresh');
    expect(r.dueIn).toBe(18);
  });

  it('boundary: 21 days ago → fresh (just inside)', () => {
    expect(photoCadenceState(daysAgo(21), TODAY).status).toBe('fresh');
  });

  it('boundary: 22 days ago → soon (first day of soon window)', () => {
    const r = photoCadenceState(daysAgo(22), TODAY);
    expect(r.status).toBe('soon');
    expect(r.dueIn).toBe(6);
  });

  it('boundary: 25 days ago → soon, dueIn 3', () => {
    const r = photoCadenceState(daysAgo(25), TODAY);
    expect(r.status).toBe('soon');
    expect(r.dueIn).toBe(3);
  });

  it('boundary: exactly 28 days ago → soon (last day before overdue)', () => {
    const r = photoCadenceState(daysAgo(28), TODAY);
    expect(r.status).toBe('soon');
    expect(r.dueIn).toBe(0);
  });

  it('boundary: 29 days ago → overdue (first day of overdue)', () => {
    const r = photoCadenceState(daysAgo(29), TODAY);
    expect(r.status).toBe('overdue');
    expect(r.dueIn).toBe(-1);
  });

  it('overdue 30 days → dueIn=-2', () => {
    const r = photoCadenceState(daysAgo(30), TODAY);
    expect(r.status).toBe('overdue');
    expect(r.dueIn).toBe(-2);
  });

  it('extremely overdue (60 days) → dueIn=-32', () => {
    const r = photoCadenceState(daysAgo(60), TODAY);
    expect(r.status).toBe('overdue');
    expect(r.dueIn).toBe(-32);
  });

  it('today (0 days ago) → fresh', () => {
    const r = photoCadenceState(daysAgo(0), TODAY);
    expect(r.status).toBe('fresh');
  });

  it('determinism: same input + same today → same output', () => {
    const a = photoCadenceState(daysAgo(15), TODAY);
    const b = photoCadenceState(daysAgo(15), TODAY);
    expect(a).toEqual(b);
  });
});
