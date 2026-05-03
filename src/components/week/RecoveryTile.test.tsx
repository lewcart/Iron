// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RecoveryTile } from './RecoveryTile';

afterEach(cleanup);

describe('RecoveryTile', () => {
  it('C4a: HRV in band + sleep ok', () => {
    render(
      <RecoveryTile
        data={{
          hrv: {
            status: 'ok',
            state: 'in-band',
            window_mean: 47,
            baseline_mean: 47,
            baseline_sd: 5,
            baseline_days: 28,
            window_days: 7,
            consecutive_below_days: 0,
          },
          sleep: { avg_min: 432, baseline_min: 420, delta_min: 12, nights_window: 7 },
          twoSignalsDown: false,
        }}
      />,
    );
    expect(screen.getByText('HRV')).toBeInTheDocument();
    expect(screen.getByText('47')).toBeInTheDocument();
    expect(screen.getByText(/in band/i)).toBeInTheDocument();
    expect(screen.getByText('7h 12m')).toBeInTheDocument();
  });

  it('C4b: HRV below + sleep down → "two signals down" warning', () => {
    render(
      <RecoveryTile
        data={{
          hrv: {
            status: 'ok',
            state: 'below',
            window_mean: 38,
            baseline_mean: 47,
            baseline_sd: 5,
            baseline_days: 28,
            window_days: 7,
            consecutive_below_days: 4,
          },
          sleep: { avg_min: 380, baseline_min: 420, delta_min: -40, nights_window: 7 },
          twoSignalsDown: true,
        }}
      />,
    );
    expect(screen.getByText(/Two signals down/i)).toBeInTheDocument();
    expect(screen.getByText(/easier session/i)).toBeInTheDocument();
  });

  it('handles missing sleep gracefully', () => {
    render(
      <RecoveryTile
        data={{
          hrv: {
            status: 'ok',
            state: 'in-band',
            window_mean: 47,
            baseline_mean: 47,
            baseline_sd: 5,
            baseline_days: 28,
            window_days: 7,
            consecutive_below_days: 0,
          },
          sleep: { avg_min: null, baseline_min: null, delta_min: null, nights_window: 0 },
          twoSignalsDown: false,
        }}
      />,
    );
    expect(screen.queryByText('Sleep avg')).not.toBeInTheDocument();
  });

  it('returns null gracefully when hrv is needs-data (defensive)', () => {
    const { container } = render(
      <RecoveryTile
        data={{
          hrv: { status: 'needs-data', reason: 'x', baseline_days: 0 } as never,
          sleep: { avg_min: null, baseline_min: null, delta_min: null, nights_window: 0 },
          twoSignalsDown: false,
        }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
