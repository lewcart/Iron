// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AnchorLiftTrendTile } from './AnchorLiftTrendTile';
import { ANCHOR_LIFTS } from '@/lib/training/anchor-lifts';

afterEach(cleanup);

describe('AnchorLiftTrendTile', () => {
  const glutesCfg = ANCHOR_LIFTS.find(a => a.muscle === 'glutes')!;
  const latsCfg = ANCHOR_LIFTS.find(a => a.muscle === 'lats')!;

  it('C3a: all anchors trending → renders deltas + sparkline', () => {
    render(
      <AnchorLiftTrendTile
        data={{
          rows: [
            {
              config: glutesCfg,
              exercise: { uuid: 'g', title: 'Hip Thrust' },
              needsData: null,
              trend: {
                sessions: [
                  { date: '2026-04-01', e1rm: 118, best_weight: 100, best_reps: 5 },
                  { date: '2026-04-08', e1rm: 124, best_weight: 105, best_reps: 5 },
                  { date: '2026-04-15', e1rm: 128, best_weight: 110, best_reps: 5 },
                  { date: '2026-04-22', e1rm: 132, best_weight: 113, best_reps: 5 },
                ],
                delta_kg: 14,
                delta_pct: 12,
              },
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('Hip Thrust')).toBeInTheDocument();
    expect(screen.getByText('132kg')).toBeInTheDocument();
    expect(screen.getByText(/\+14\.0kg/)).toBeInTheDocument();
  });

  it('C3b: row with needs-data renders inline', () => {
    render(
      <AnchorLiftTrendTile
        data={{
          rows: [
            { config: latsCfg, exercise: null, needsData: { reason: 'Hip Thrust trend needs 1 more session' }, trend: null },
          ],
        }}
      />,
    );
    expect(screen.getByText(/needs 1 more session/i)).toBeInTheDocument();
  });

  it('C3c: partial — mix of ok rows and needs-data rows', () => {
    render(
      <AnchorLiftTrendTile
        data={{
          rows: [
            {
              config: glutesCfg,
              exercise: { uuid: 'g', title: 'Hip Thrust' },
              needsData: null,
              trend: {
                sessions: [
                  { date: '2026-04-01', e1rm: 118, best_weight: 100, best_reps: 5 },
                  { date: '2026-04-15', e1rm: 124, best_weight: 105, best_reps: 5 },
                  { date: '2026-04-22', e1rm: 130, best_weight: 110, best_reps: 5 },
                ],
                delta_kg: 12,
                delta_pct: 10,
              },
            },
            { config: latsCfg, exercise: null, needsData: { reason: 'no exercise' }, trend: null },
          ],
        }}
      />,
    );
    expect(screen.getByText('Hip Thrust')).toBeInTheDocument();
    expect(screen.getByText(/no exercise/i)).toBeInTheDocument();
  });

  it('aria-label on each row summarizes trend or reason', () => {
    render(
      <AnchorLiftTrendTile
        data={{
          rows: [
            {
              config: glutesCfg,
              exercise: { uuid: 'g', title: 'Hip Thrust' },
              needsData: null,
              trend: {
                sessions: [
                  { date: '2026-04-01', e1rm: 118, best_weight: 100, best_reps: 5 },
                  { date: '2026-04-22', e1rm: 132, best_weight: 113, best_reps: 5 },
                ],
                delta_kg: 14,
                delta_pct: 12,
              },
            },
          ],
        }}
      />,
    );
    expect(screen.getByLabelText(/Hip Thrust estimated 1RM trend/i)).toBeInTheDocument();
  });
});
