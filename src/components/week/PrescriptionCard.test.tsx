// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { PrescriptionCard } from './PrescriptionCard';
import type { PrescriptionEngineResult } from '@/lib/training/prescription-engine';

afterEach(cleanup);

const EMPTY_RESULT: PrescriptionEngineResult = {
  prescriptions: [],
  eligibility: { eligible: 0, ineligible: 0 },
  hrtContextNotes: [],
  totalSetsAdded: 0,
};

describe('PrescriptionCard', () => {
  it('renders skeleton when data is null', () => {
    const { container } = render(<PrescriptionCard data={null} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders nothing when zero eligible AND zero ineligible (no priority muscles at all)', () => {
    const { container } = render(<PrescriptionCard data={EMPTY_RESULT} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "warming up" copy when ALL muscles ineligible', () => {
    const data: PrescriptionEngineResult = {
      prescriptions: [],
      eligibility: { eligible: 0, ineligible: 4 },
      hrtContextNotes: [],
      totalSetsAdded: 0,
    };
    render(<PrescriptionCard data={data} />);
    expect(screen.getByText(/building your prescription/i)).toBeInTheDocument();
    expect(screen.getByText(/4 priority muscles still warming up/i)).toBeInTheDocument();
  });

  it('renders nothing when eligible muscles all HOLD (engine returned empty prescriptions)', () => {
    const data: PrescriptionEngineResult = {
      prescriptions: [],
      eligibility: { eligible: 3, ineligible: 0 },
      hrtContextNotes: [],
      totalSetsAdded: 0,
    };
    const { container } = render(<PrescriptionCard data={data} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a single PUSH row with action label and chevron', () => {
    const data: PrescriptionEngineResult = {
      prescriptions: [
        {
          muscle: 'glutes',
          action: 'PUSH',
          delta: { sets: 1 },
          reasons: [],
          confidence: 'medium',
        },
      ],
      eligibility: { eligible: 1, ineligible: 0 },
      hrtContextNotes: [],
      totalSetsAdded: 1,
    };
    render(<PrescriptionCard data={data} />);
    expect(screen.getByText('Glutes')).toBeInTheDocument();
    expect(screen.getByText(/PUSH \+1 set$/)).toBeInTheDocument();
  });

  it('renders DELOAD row with whole-body label', () => {
    const data: PrescriptionEngineResult = {
      prescriptions: [
        {
          muscle: 'whole-body',
          action: 'DELOAD',
          delta: {},
          reasons: [
            { kind: 'hrv_low', sigma: 1.2 },
            { kind: 'rir_drift', muscle: 'glutes', delta: 0.7 },
          ],
          confidence: 'high',
        },
      ],
      eligibility: { eligible: 2, ineligible: 0 },
      hrtContextNotes: [],
      totalSetsAdded: 0,
    };
    render(<PrescriptionCard data={data} />);
    expect(screen.getByText('Whole body')).toBeInTheDocument();
    expect(screen.getByText('DELOAD')).toBeInTheDocument();
    // Reason chips render
    expect(screen.getByText('HRV ↓1.2σ')).toBeInTheDocument();
    expect(screen.getByText('RIR drift')).toBeInTheDocument();
  });

  it('reason chip aria-label expands symbols (a11y)', () => {
    const data: PrescriptionEngineResult = {
      prescriptions: [
        {
          muscle: 'whole-body',
          action: 'DELOAD',
          delta: {},
          reasons: [{ kind: 'hrv_low', sigma: 1.2 }],
          confidence: 'high',
        },
      ],
      eligibility: { eligible: 1, ineligible: 0 },
      hrtContextNotes: [],
      totalSetsAdded: 0,
    };
    const { container } = render(<PrescriptionCard data={data} />);
    const chip = container.querySelector('[aria-label*="standard deviations"]');
    expect(chip).not.toBeNull();
  });

  it('renders HRT context note when provided', () => {
    const data: PrescriptionEngineResult = {
      prescriptions: [
        {
          muscle: 'glutes',
          action: 'REDUCE',
          delta: { sets: -1 },
          reasons: [{ kind: 'rir_drift', muscle: 'glutes', delta: 1.2 }],
          confidence: 'high',
        },
      ],
      eligibility: { eligible: 1, ineligible: 0 },
      hrtContextNotes: ['Recent protocol change (2 weeks ago) — strength variance expected'],
      totalSetsAdded: 0,
    };
    render(<PrescriptionCard data={data} />);
    expect(screen.getByText(/recent protocol change/i)).toBeInTheDocument();
  });

  it('renders partial-state footer when some muscles ineligible alongside eligible recs', () => {
    const data: PrescriptionEngineResult = {
      prescriptions: [
        {
          muscle: 'glutes',
          action: 'PUSH',
          delta: { sets: 1 },
          reasons: [],
          confidence: 'medium',
        },
      ],
      eligibility: { eligible: 1, ineligible: 2 },  // 1 of 3 eligible
      hrtContextNotes: [],
      totalSetsAdded: 1,
    };
    render(<PrescriptionCard data={data} />);
    expect(screen.getByText(/2 of 3 priority muscles still warming up/i)).toBeInTheDocument();
  });

  it('row is a button with min-h-[44px] (touch target)', () => {
    const data: PrescriptionEngineResult = {
      prescriptions: [
        {
          muscle: 'glutes',
          action: 'PUSH',
          delta: { sets: 1 },
          reasons: [],
          confidence: 'medium',
        },
      ],
      eligibility: { eligible: 1, ineligible: 0 },
      hrtContextNotes: [],
      totalSetsAdded: 1,
    };
    const { container } = render(<PrescriptionCard data={data} />);
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn?.className).toMatch(/min-h-\[44px\]/);
  });

  it('clicking a row opens the sheet with the explanation', () => {
    const data: PrescriptionEngineResult = {
      prescriptions: [
        {
          muscle: 'glutes',
          action: 'REDUCE',
          delta: { sets: -1 },
          reasons: [{ kind: 'rir_drift', muscle: 'glutes', delta: 1.5 }],
          confidence: 'high',
        },
      ],
      eligibility: { eligible: 1, ineligible: 0 },
      hrtContextNotes: [],
      totalSetsAdded: 0,
    };
    render(<PrescriptionCard data={data} />);
    const btn = screen.getByRole('button', { name: /glutes/i });
    fireEvent.click(btn);
    // Sheet renders the full explanation text
    expect(screen.getByText(/closer to failure/i)).toBeInTheDocument();
  });

  it('eyebrow "NEXT WEEK" appears when prescriptions exist', () => {
    const data: PrescriptionEngineResult = {
      prescriptions: [
        {
          muscle: 'glutes',
          action: 'PUSH',
          delta: { sets: 2 },
          reasons: [],
          confidence: 'medium',
        },
      ],
      eligibility: { eligible: 1, ineligible: 0 },
      hrtContextNotes: [],
      totalSetsAdded: 2,
    };
    render(<PrescriptionCard data={data} />);
    expect(screen.getByText('Next Week')).toBeInTheDocument();
  });
});
