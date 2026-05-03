// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CardioComplianceTile, type CardioTileResponse } from './CardioComplianceTile';

afterEach(cleanup);

describe('CardioComplianceTile', () => {
  it('renders skeleton when data is null (loading)', () => {
    const { container } = render(<CardioComplianceTile data={null} />);
    const sk = container.querySelector('div.animate-pulse');
    expect(sk).not.toBeNull();
  });

  it('renders nothing when status=no_targets (silent — design spec)', () => {
    const data: CardioTileResponse = {
      status: 'no_targets',
      message: 'no targets',
    };
    const { container } = render(<CardioComplianceTile data={data} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Connect HealthKit CTA when status=not_connected', () => {
    const data: CardioTileResponse = {
      status: 'not_connected',
      reason: 'not_requested',
    };
    render(<CardioComplianceTile data={data} />);
    expect(screen.getByText(/connect healthkit/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open settings/i })).toBeInTheDocument();
  });

  it('renders single-ring mode when only umbrella target is set', () => {
    const data: CardioTileResponse = {
      status: 'ok',
      range: { start_date: '2026-04-26', end_date: '2026-05-02' },
      totals: { zone2: 0, intervals: 0, total: 180 },
      targets: { total: 240, zone2: null, intervals: null, any_set: true, split: false },
      daily: [],
    };
    render(<CardioComplianceTile data={data} />);
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText('/ 240')).toBeInTheDocument();
    expect(screen.getByText(/60 min to target/i)).toBeInTheDocument();
  });

  it('renders single-ring "Target hit" copy when minutes >= target', () => {
    const data: CardioTileResponse = {
      status: 'ok',
      range: { start_date: '2026-04-26', end_date: '2026-05-02' },
      totals: { zone2: 0, intervals: 0, total: 250 },
      targets: { total: 240, zone2: null, intervals: null, any_set: true, split: false },
      daily: [],
    };
    render(<CardioComplianceTile data={data} />);
    expect(screen.getByText(/target hit/i)).toBeInTheDocument();
  });

  it('renders split mode when both sub-targets set', () => {
    const data: CardioTileResponse = {
      status: 'ok',
      range: { start_date: '2026-04-26', end_date: '2026-05-02' },
      totals: { zone2: 140, intervals: 40, total: 180 },
      targets: { total: 240, zone2: 180, intervals: 60, any_set: true, split: true },
      daily: [],
    };
    render(<CardioComplianceTile data={data} />);
    expect(screen.getByText('Zone 2')).toBeInTheDocument();
    expect(screen.getByText('Intervals')).toBeInTheDocument();
    // Numbers from each row (regex anchored to avoid matching 140 with /40/)
    expect(screen.getByText(/140/)).toBeInTheDocument();
    expect(screen.getByText(/^\s*40/)).toBeInTheDocument();
  });

  it('split mode renders only the rows whose targets are set (zone2 only)', () => {
    const data: CardioTileResponse = {
      status: 'ok',
      range: { start_date: '2026-04-26', end_date: '2026-05-02' },
      totals: { zone2: 140, intervals: 0, total: 140 },
      targets: { total: null, zone2: 180, intervals: null, any_set: true, split: true },
      daily: [],
    };
    render(<CardioComplianceTile data={data} />);
    expect(screen.getByText('Zone 2')).toBeInTheDocument();
    expect(screen.queryByText('Intervals')).toBeNull();
  });

  it('split mode renders only intervals when only intervals target is set', () => {
    const data: CardioTileResponse = {
      status: 'ok',
      range: { start_date: '2026-04-26', end_date: '2026-05-02' },
      totals: { zone2: 0, intervals: 40, total: 40 },
      targets: { total: null, zone2: null, intervals: 60, any_set: true, split: true },
      daily: [],
    };
    render(<CardioComplianceTile data={data} />);
    expect(screen.queryByText('Zone 2')).toBeNull();
    expect(screen.getByText('Intervals')).toBeInTheDocument();
  });

  it('zero-workouts week with target set renders 0/target silently (no warning copy)', () => {
    const data: CardioTileResponse = {
      status: 'ok',
      range: { start_date: '2026-04-26', end_date: '2026-05-02' },
      totals: { zone2: 0, intervals: 0, total: 0 },
      targets: { total: 240, zone2: null, intervals: null, any_set: true, split: false },
      daily: [],
    };
    render(<CardioComplianceTile data={data} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('/ 240')).toBeInTheDocument();
    // No warning icon / alert text
    expect(screen.queryByText(/warning/i)).toBeNull();
    expect(screen.queryByText(/missing/i)).toBeNull();
    expect(screen.queryByText(/HR-zone/i)).toBeNull();
  });

  it('aria-label is present on the tile section for screen readers', () => {
    const data: CardioTileResponse = {
      status: 'ok',
      range: { start_date: '2026-04-26', end_date: '2026-05-02' },
      totals: { zone2: 0, intervals: 0, total: 180 },
      targets: { total: 240, zone2: null, intervals: null, any_set: true, split: false },
      daily: [],
    };
    const { container } = render(<CardioComplianceTile data={data} />);
    const section = container.querySelector('section');
    expect(section?.getAttribute('aria-label')).toMatch(/cardio/i);
  });

  it('eyebrow "Cardio" + "this week" appears on render', () => {
    const data: CardioTileResponse = {
      status: 'ok',
      range: { start_date: '2026-04-26', end_date: '2026-05-02' },
      totals: { zone2: 0, intervals: 0, total: 180 },
      targets: { total: 240, zone2: null, intervals: null, any_set: true, split: false },
      daily: [],
    };
    render(<CardioComplianceTile data={data} />);
    expect(screen.getByText('Cardio')).toBeInTheDocument();
    expect(screen.getByText('this week')).toBeInTheDocument();
  });
});
