// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PriorityMusclesTile } from './PriorityMusclesTile';
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
});
