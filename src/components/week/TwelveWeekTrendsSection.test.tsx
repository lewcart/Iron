// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  TwelveWeekTrendsSection,
  type TwelveWeekTrendsData,
} from './TwelveWeekTrendsSection';

afterEach(cleanup);

const empty: TwelveWeekTrendsData = {
  priorityMuscles: [],
  anchorLifts: [],
  bodyweight: null,
  hrv: null,
  compliance: null,
};

describe('TwelveWeekTrendsSection', () => {
  it('renders a 12-Week Trends header', () => {
    render(<TwelveWeekTrendsSection data={empty} />);
    expect(screen.getByText(/12-Week Trends/i)).toBeInTheDocument();
  });

  it('renders all 5 trend block labels (a-e) even when data is missing', () => {
    render(<TwelveWeekTrendsSection data={empty} />);
    // Use exact label substrings (not /Priority muscles/ which also appears
    // in the empty-state copy below the label).
    expect(screen.getByText(/Priority muscles · sets \/ week/i)).toBeInTheDocument();
    expect(screen.getByText(/Anchor-lift e1RM/i)).toBeInTheDocument();
    expect(screen.getByText(/Bodyweight EWMA · 90 day/i)).toBeInTheDocument();
    expect(screen.getByText(/HRV · 7-day mean vs 28-day baseline/i)).toBeInTheDocument();
    expect(screen.getByText(/Weekly compliance · sets executed vs plan/i)).toBeInTheDocument();
  });

  it('shows empty-state copy for each trend when no data', () => {
    render(<TwelveWeekTrendsSection data={empty} />);
    expect(screen.getByText(/Trends fill in as you log priority muscles/i)).toBeInTheDocument();
    expect(screen.getByText(/Log a few sessions on your anchor lifts/i)).toBeInTheDocument();
    expect(screen.getByText(/Need more weigh-ins/i)).toBeInTheDocument();
    expect(screen.getByText(/HRV baseline still calibrating/i)).toBeInTheDocument();
    expect(screen.getByText(/Compliance trend will appear/i)).toBeInTheDocument();
  });

  it('renders priority-muscle inline sparkline + direction chip when data is present', () => {
    const data: TwelveWeekTrendsData = {
      ...empty,
      priorityMuscles: [
        { slug: 'glutes', display_name: 'Glutes', weekly: [3, 4, 5, 6, 6, 7, 8, 7, 8, 9, 10, 9] },
        { slug: 'lats', display_name: 'Lats', weekly: [4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10] },
      ],
    };
    render(<TwelveWeekTrendsSection data={data} />);
    // Tap-to-open button is rendered with an "open detail" aria-label.
    expect(
      screen.getByRole('button', { name: /Priority muscles · sets \/ week — open detail/i }),
    ).toBeInTheDocument();
    // Direction chip carries the % change (3 → 9 ≈ +200%).
    expect(screen.getByText(/↗\s*\+/)).toBeInTheDocument();
  });

  it('renders anchor-lift row with sparkline + direction chip when data is present', () => {
    const data: TwelveWeekTrendsData = {
      ...empty,
      anchorLifts: [
        {
          display_name: 'Hip Thrust',
          sessions: [
            { date: '2026-02-01', e1rm: 100 },
            { date: '2026-02-08', e1rm: 105 },
            { date: '2026-02-15', e1rm: 108 },
            { date: '2026-02-22', e1rm: 110 },
          ],
        },
      ],
    };
    render(<TwelveWeekTrendsSection data={data} />);
    expect(
      screen.getByRole('button', { name: /Anchor-lift e1RM — open detail/i }),
    ).toBeInTheDocument();
  });

  it('renders bodyweight EWMA sparkline when ≥7 points provided', () => {
    const data: TwelveWeekTrendsData = {
      ...empty,
      bodyweight: { ewma: [70, 70.1, 70.2, 70.0, 69.9, 69.8, 69.7, 69.6, 69.5] },
    };
    render(<TwelveWeekTrendsSection data={data} />);
    expect(
      screen.getByRole('button', { name: /Bodyweight EWMA · 90 day — open detail/i }),
    ).toBeInTheDocument();
  });

  it('renders HRV sparkline with band overlay when baseline + SD provided', () => {
    const data: TwelveWeekTrendsData = {
      ...empty,
      hrv: {
        rolling7: [50, 51, 52, 49, 48, 50, 53, 51, 52],
        baseline28: 50,
        baselineSd: 5,
      },
    };
    render(<TwelveWeekTrendsSection data={data} />);
    expect(
      screen.getByRole('button', { name: /HRV · 7-day mean vs 28-day baseline — open detail/i }),
    ).toBeInTheDocument();
    // Band-occupancy chip ("9 / 9 in band").
    expect(screen.getByText(/in band/i)).toBeInTheDocument();
  });

  it('section is exposed via aria-label for screen readers', () => {
    render(<TwelveWeekTrendsSection data={empty} />);
    expect(screen.getByLabelText('12-week trends')).toBeInTheDocument();
  });

  // ── Regression: HRV row when baseline is calibrating ──────────────────────
  // Covers the NaN bug from QA verify pass: when HRV baselineSd is null
  // (calibrating), the band math would emit `<rect y="NaN" height="NaN">`
  // instead of short-circuiting to the empty-state copy.

  it('HRV row falls back to empty-state when baseline is calibrating (no SD)', () => {
    const data: TwelveWeekTrendsData = {
      ...empty,
      hrv: {
        rolling7: [50, 51, 52, 49, 48, 50, 53, 51, 52, 50, 51, 49],
        baseline28: 50,
        baselineSd: null, // calibrating
      },
    };
    const { container } = render(<TwelveWeekTrendsSection data={data} />);
    expect(screen.getByText(/HRV baseline still calibrating/i)).toBeInTheDocument();
    // No HRV sparkline rendered.
    expect(screen.queryByLabelText(/HRV 7-day mean vs 28-day baseline band/i))
      .not.toBeInTheDocument();
    // Sanity: zero NaN attributes anywhere in the rendered DOM.
    const html = container.innerHTML;
    expect(html).not.toContain('NaN');
  });

  it('HRV row falls back to empty-state when baseline28 is null', () => {
    const data: TwelveWeekTrendsData = {
      ...empty,
      hrv: {
        rolling7: [50, 51, 52, 49, 48, 50, 53],
        baseline28: null,
        baselineSd: null,
      },
    };
    render(<TwelveWeekTrendsSection data={data} />);
    expect(screen.getByText(/HRV baseline still calibrating/i)).toBeInTheDocument();
  });

  it('HRV row falls back to empty-state when rolling7 has fewer than 7 points', () => {
    const data: TwelveWeekTrendsData = {
      ...empty,
      hrv: {
        rolling7: [50, 51, 52], // only 3 points
        baseline28: 50,
        baselineSd: 5,
      },
    };
    render(<TwelveWeekTrendsSection data={data} />);
    expect(screen.getByText(/HRV baseline still calibrating/i)).toBeInTheDocument();
  });

  it('renders HRV sparkline cleanly (no NaN attributes) when fully calibrated', () => {
    const data: TwelveWeekTrendsData = {
      ...empty,
      hrv: {
        rolling7: [50, 51, 52, 49, 48, 50, 53, 51, 52],
        baseline28: 50,
        baselineSd: 5,
      },
    };
    const { container } = render(<TwelveWeekTrendsSection data={data} />);
    expect(container.innerHTML).not.toContain('NaN');
    // Sanity-check the rendered SVG attributes are all finite numbers.
    const rect = container.querySelector('svg rect');
    expect(rect).not.toBeNull();
    expect(Number.isFinite(Number(rect!.getAttribute('y')))).toBe(true);
    expect(Number.isFinite(Number(rect!.getAttribute('height')))).toBe(true);
  });
});
