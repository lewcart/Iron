// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { EffectiveSetQualityTile } from './EffectiveSetQualityTile';

afterEach(cleanup);

describe('EffectiveSetQualityTile', () => {
  it('C2a: renders 78% with sparkline', () => {
    render(
      <EffectiveSetQualityTile
        data={{
          quality_pct: 78,
          total_sets: 24,
          rir_logged_sets: 22,
          rir_quality_sets: 17,
          history: [
            { week_start: '2026-03-01', quality_pct: 70, n_sets: 18 },
            { week_start: '2026-03-08', quality_pct: 75, n_sets: 22 },
            { week_start: '2026-03-15', quality_pct: 78, n_sets: 24 },
            { week_start: '2026-03-22', quality_pct: 76, n_sets: 24 },
          ],
        }}
      />,
    );
    expect(screen.getByText('78%')).toBeInTheDocument();
    expect(screen.getByText(/at RIR ≤ 3/i)).toBeInTheDocument();
    expect(screen.getByText(/17 of 22 logged sets/i)).toBeInTheDocument();
  });

  it('renders unlogged set count when present', () => {
    render(
      <EffectiveSetQualityTile
        data={{
          quality_pct: 80,
          total_sets: 20,
          rir_logged_sets: 10,
          rir_quality_sets: 8,
          history: [],
        }}
      />,
    );
    expect(screen.getByText(/10 unlogged/)).toBeInTheDocument();
  });

  it('quality color tone changes with %', () => {
    const { rerender } = render(
      <EffectiveSetQualityTile
        data={{ quality_pct: 30, total_sets: 10, rir_logged_sets: 10, rir_quality_sets: 3, history: [] }}
      />,
    );
    expect(screen.getByText('30%')).toBeInTheDocument();
    rerender(
      <EffectiveSetQualityTile
        data={{ quality_pct: 90, total_sets: 10, rir_logged_sets: 10, rir_quality_sets: 9, history: [] }}
      />,
    );
    expect(screen.getByText('90%')).toBeInTheDocument();
  });

  it('aria-label summarises quality', () => {
    render(
      <EffectiveSetQualityTile
        data={{ quality_pct: 78, total_sets: 24, rir_logged_sets: 22, rir_quality_sets: 17, history: [] }}
      />,
    );
    expect(screen.getByLabelText(/Effective set quality: 78%/)).toBeInTheDocument();
  });
});
