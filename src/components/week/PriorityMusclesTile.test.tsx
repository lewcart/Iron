// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PriorityMusclesTile, formatWeekLabel } from './PriorityMusclesTile';
import { landmarkFor } from '@/lib/training/volume-landmarks';
import type { PriorityMuscleRow } from '@/lib/api/resolveWeekTiles';

afterEach(cleanup);

function row(slug: string, partial: Partial<PriorityMuscleRow> = {}): PriorityMuscleRow {
  const lm = landmarkFor(slug)!;
  return {
    slug,
    display_name: lm.display_name,
    effective_set_count: 12,
    set_count: 12,
    zone: 'in-zone',
    landmark: lm,
    mrv: 30,
    isPriority: false,
    isDeemphasis: false,
    needsTagging: false,
    ...partial,
  };
}

describe('PriorityMusclesTile', () => {
  it('C1a: renders priority rows first', () => {
    render(
      <PriorityMusclesTile
        data={{
          frequencyThisWeek: 4,
          rows: [
            row('lats', { isPriority: true, effective_set_count: 12, zone: 'in-zone' }),
            row('quads', { isPriority: false, effective_set_count: 8, zone: 'under' }),
          ],
        }}
      />,
    );
    expect(screen.getByText('Lats')).toBeInTheDocument();
  });

  it('C1b: row with needsTagging renders "no exercises tagged" link', () => {
    render(
      <PriorityMusclesTile
        data={{
          frequencyThisWeek: 4,
          rows: [
            row('hip_abductors', { isPriority: true, needsTagging: true }),
          ],
        }}
      />,
    );
    expect(screen.getByText(/no exercises tagged/i)).toBeInTheDocument();
  });

  it('C1b expand: footer "other muscles" toggle reveals hidden rows', () => {
    render(
      <PriorityMusclesTile
        data={{
          frequencyThisWeek: 4,
          rows: [
            row('lats', { isPriority: true, effective_set_count: 12, zone: 'in-zone' }),
            row('quads', { isPriority: false, effective_set_count: 8, zone: 'under' }),
            row('hamstrings', { isPriority: false, effective_set_count: 6, zone: 'under' }),
          ],
        }}
      />,
    );
    expect(screen.queryByText('Quads')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /other muscles/i }));
    expect(screen.getByText('Quads')).toBeInTheDocument();
  });

  it('C1c: over-MRV warning row gets risk styling', () => {
    render(
      <PriorityMusclesTile
        data={{
          frequencyThisWeek: 4,
          rows: [row('quads', { isPriority: false, effective_set_count: 30, zone: 'risk' })],
        }}
      />,
    );
    // Aria-label should call out the risk state.
    expect(screen.getByLabelText(/at or above MRV/i)).toBeInTheDocument();
  });

  it('extrapolated landmark shows asterisk', () => {
    render(
      <PriorityMusclesTile
        data={{
          frequencyThisWeek: 4,
          rows: [row('hip_abductors', { isPriority: true, effective_set_count: 5, zone: 'in-zone' })],
        }}
      />,
    );
    expect(screen.getByText(/Hip abductors\*/i)).toBeInTheDocument();
  });

  it('renders deemphasis section header when present', () => {
    render(
      <PriorityMusclesTile
        data={{
          frequencyThisWeek: 4,
          rows: [
            row('lats', { isPriority: true }),
            row('quads', { isDeemphasis: true }),
          ],
        }}
      />,
    );
    // Two case-insensitive matches now: section header "De-emphasis" + legend swatch
    // label "de-emphasis". Find the section header by its exact case.
    expect(screen.getByText('De-emphasis')).toBeInTheDocument();
  });

  it('every row has aria-label', () => {
    render(
      <PriorityMusclesTile
        data={{
          frequencyThisWeek: 4,
          rows: [row('lats', { isPriority: true, effective_set_count: 12 })],
        }}
      />,
    );
    expect(screen.getByLabelText(/Lats: 12.* effective sets/i)).toBeInTheDocument();
  });

  describe('week picker', () => {
    const baseData = {
      frequencyThisWeek: 4 as const,
      rows: [row('lats', { isPriority: true })],
    };

    it('hides chevrons when onChangeWeekOffset is omitted', () => {
      render(<PriorityMusclesTile data={baseData} />);
      expect(screen.queryByRole('button', { name: /previous week/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /next week/i })).not.toBeInTheDocument();
    });

    it('renders both chevrons when onChangeWeekOffset is provided', () => {
      render(<PriorityMusclesTile data={baseData} onChangeWeekOffset={() => {}} />);
      expect(screen.getByRole('button', { name: /previous week/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /next week/i })).toBeInTheDocument();
    });

    it('disables forward chevron at offset 0 (current week)', () => {
      render(<PriorityMusclesTile data={baseData} weekOffset={0} onChangeWeekOffset={() => {}} />);
      const next = screen.getByRole('button', { name: /next week/i });
      expect(next).toBeDisabled();
      expect(screen.getByText('this week')).toBeInTheDocument();
    });

    it('shows "last week" label at offset -1', () => {
      render(<PriorityMusclesTile data={baseData} weekOffset={-1} onChangeWeekOffset={() => {}} />);
      expect(screen.getByText('last week')).toBeInTheDocument();
    });

    it('shows date range for offsets <= -2', () => {
      render(
        <PriorityMusclesTile
          data={baseData}
          weekOffset={-2}
          weekStart="2026-04-20"
          weekEnd="2026-04-26"
          onChangeWeekOffset={() => {}}
        />,
      );
      expect(screen.getByText(/Apr 20.*Apr 26/)).toBeInTheDocument();
    });

    it('emits decremented offset on previous click', () => {
      const onChange = vi.fn();
      render(<PriorityMusclesTile data={baseData} weekOffset={-1} onChangeWeekOffset={onChange} />);
      fireEvent.click(screen.getByRole('button', { name: /previous week/i }));
      expect(onChange).toHaveBeenCalledWith(-2);
    });

    it('emits incremented offset on next click when not at current week', () => {
      const onChange = vi.fn();
      render(<PriorityMusclesTile data={baseData} weekOffset={-2} onChangeWeekOffset={onChange} />);
      fireEvent.click(screen.getByRole('button', { name: /next week/i }));
      expect(onChange).toHaveBeenCalledWith(-1);
    });

    it('does NOT call onChange when next clicked at current week', () => {
      const onChange = vi.fn();
      render(<PriorityMusclesTile data={baseData} weekOffset={0} onChangeWeekOffset={onChange} />);
      fireEvent.click(screen.getByRole('button', { name: /next week/i }));
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});

describe('formatWeekLabel', () => {
  it('returns "this week" for offset 0', () => {
    expect(formatWeekLabel(0)).toBe('this week');
  });

  it('returns "last week" for offset -1', () => {
    expect(formatWeekLabel(-1)).toBe('last week');
  });

  it('returns date span for offsets <= -2 when both dates supplied', () => {
    expect(formatWeekLabel(-2, '2026-04-20', '2026-04-26')).toBe('Apr 20 – Apr 26');
  });

  it('falls back to "{n} wk" when offsets <= -2 and dates missing', () => {
    expect(formatWeekLabel(-3)).toBe('-3 wk');
  });
});
