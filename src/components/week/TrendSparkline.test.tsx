// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TrendSparkline } from './TrendSparkline';

afterEach(cleanup);

describe('TrendSparkline', () => {
  it('T1: renders 12 data points', () => {
    const values = Array.from({ length: 12 }, (_, i) => i + 1);
    render(<TrendSparkline values={values} ariaLabel="Test trend" />);
    const svg = screen.getByRole('img', { name: 'Test trend' });
    expect(svg.tagName.toLowerCase()).toBe('svg');
  });

  it('T2: with <minSamples → renders empty-state text', () => {
    render(<TrendSparkline values={[1, 2]} ariaLabel="Test" minSamples={4} />);
    expect(screen.getByText(/trends fill in as you log/i)).toBeInTheDocument();
  });

  it('uses custom emptyText when provided', () => {
    render(<TrendSparkline values={[1]} ariaLabel="Test" minSamples={4} emptyText="Not enough yet" />);
    expect(screen.getByText('Not enough yet')).toBeInTheDocument();
  });

  it('T3: with band → renders shaded rect', () => {
    const values = [10, 12, 15, 18];
    const { container } = render(
      <TrendSparkline values={values} ariaLabel="HRV" band={[10, 16]} />,
    );
    const rect = container.querySelector('svg rect');
    expect(rect).not.toBeNull();
  });

  it('always sets aria-label on the svg/img element', () => {
    render(<TrendSparkline values={[1, 2, 3, 4]} ariaLabel="Hip Thrust e1RM trend" />);
    expect(screen.getByLabelText('Hip Thrust e1RM trend')).toBeInTheDocument();
  });

  it('uses minSamples=4 by default for the empty-state branch', () => {
    render(<TrendSparkline values={[1, 2, 3]} ariaLabel="x" />);
    expect(screen.getByText(/trends fill in as you log/i)).toBeInTheDocument();
  });

  // ── Regression: defensive NaN handling ────────────────────────────────────
  // Earlier passes emitted `<rect y="NaN" height="NaN">` and
  // `<path d="…L9.09,NaN…">` when values or band edges were NaN (typically
  // from upstream HRV math during baseline calibration). The sparkline now
  // filters non-finite values + ignores a NaN band.

  it('drops NaN values from `values` before drawing', () => {
    const { container } = render(
      <TrendSparkline values={[10, NaN, 12, 14, 16, 18]} ariaLabel="trend" />,
    );
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('treats a NaN band as no band (does not render rect with NaN attrs)', () => {
    const { container } = render(
      <TrendSparkline
        values={[10, 12, 14, 16]}
        band={[NaN, NaN]}
        ariaLabel="trend"
      />,
    );
    expect(container.innerHTML).not.toContain('NaN');
    // No rect at all when band is invalid.
    expect(container.querySelector('svg rect')).toBeNull();
  });

  it('falls back to empty-state when ALL values are NaN', () => {
    render(
      <TrendSparkline
        values={[NaN, NaN, NaN, NaN]}
        ariaLabel="trend"
        minSamples={4}
      />,
    );
    expect(screen.getByText(/trends fill in as you log/i)).toBeInTheDocument();
  });
});
