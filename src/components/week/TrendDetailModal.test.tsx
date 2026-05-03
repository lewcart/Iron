// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  TrendDetailModal,
  summarizeDirection,
  summarizeHrvBand,
} from './TrendDetailModal';

afterEach(cleanup);

describe('summarizeDirection (V1.1 inline chip)', () => {
  it('returns flat with → arrow when delta is within 1% deadzone', () => {
    expect(summarizeDirection([100, 100.5])).toEqual({
      arrow: '→',
      pct: 0.5,
      tone: 'flat',
      text: 'flat',
    });
  });

  it('returns positive direction with + sign and 1-decimal precision', () => {
    expect(summarizeDirection([100, 112])).toEqual({
      arrow: '↗',
      pct: 12,
      tone: 'pos',
      text: '+12.0%',
    });
  });

  it('returns negative direction with minus sign', () => {
    const r = summarizeDirection([100, 97]);
    expect(r.arrow).toBe('↘');
    expect(r.tone).toBe('neg');
    expect(r.text).toBe('-3.0%');
  });

  it('returns flat when fewer than 2 finite values', () => {
    expect(summarizeDirection([100]).text).toBe('—');
    expect(summarizeDirection([]).text).toBe('—');
  });

  it('handles first==0 by reporting absolute movement (no division)', () => {
    expect(summarizeDirection([0, 5]).arrow).toBe('↗');
    expect(summarizeDirection([0, -5]).arrow).toBe('↘');
    expect(summarizeDirection([0, 0]).arrow).toBe('→');
  });

  it('skips NaN/non-finite values when computing direction', () => {
    expect(summarizeDirection([NaN, 100, NaN, 110, NaN]).text).toBe('+10.0%');
  });
});

describe('summarizeHrvBand (V1.1 HRV occupancy chip)', () => {
  it('counts how many points are within the band', () => {
    const r = summarizeHrvBand([45, 50, 55, 60, 40], [45, 55]);
    expect(r.text).toBe('3 / 5 in band');
  });

  it('tone is positive when ≥70% of points are in band', () => {
    expect(summarizeHrvBand([50, 50, 50, 50, 50], [45, 55]).tone).toBe('pos');
  });

  it('tone is negative when ≤30% of points are in band', () => {
    expect(summarizeHrvBand([10, 20, 30, 40, 50], [45, 55]).tone).toBe('neg');
  });

  it('returns dash when no values', () => {
    expect(summarizeHrvBand([], [45, 55]).text).toBe('—');
  });
});

describe('TrendDetailModal', () => {
  it('renders the rule explanation + a series numbers panel', () => {
    render(
      <TrendDetailModal
        open
        onClose={() => {}}
        title="Test trend"
        series={[{
          label: 'Hip Thrust',
          values: [100, 105, 110, 115],
          xLabels: ['2026-01-01', '2026-01-08', '2026-01-15', '2026-01-22'],
          unit: 'kg',
        }]}
        rule="Estimated 1RM via Epley formula."
      />,
    );
    expect(screen.getByText(/Estimated 1RM via Epley/)).toBeInTheDocument();
    expect(screen.getByText('Hip Thrust')).toBeInTheDocument();
    expect(screen.getByText(/Latest:/)).toBeInTheDocument();
    expect(screen.getByText(/Change:/)).toBeInTheDocument();
  });

  it('renders empty state when all series are empty', () => {
    render(
      <TrendDetailModal
        open
        onClose={() => {}}
        title="Empty"
        series={[]}
        rule="x"
      />,
    );
    expect(screen.getByText(/No data to chart yet/)).toBeInTheDocument();
  });

  it('does not render when open=false', () => {
    render(
      <TrendDetailModal
        open={false}
        onClose={() => {}}
        title="Hidden"
        series={[{ label: 's', values: [1, 2, 3], xLabels: ['a', 'b', 'c'] }]}
        rule="r"
      />,
    );
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });
});
