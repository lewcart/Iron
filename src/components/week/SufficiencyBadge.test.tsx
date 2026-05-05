// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SufficiencyBadge } from './SufficiencyBadge';

afterEach(cleanup);

describe('SufficiencyBadge', () => {
  it('renders nothing when weeks is null', () => {
    const { container } = render(<SufficiencyBadge weeks={null} muscleName="Glutes" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when weeks is undefined', () => {
    const { container } = render(<SufficiencyBadge weeks={undefined} muscleName="Glutes" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when weeks >= 8 (silent past threshold)', () => {
    const { container } = render(<SufficiencyBadge weeks={8} muscleName="Glutes" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for 12 weeks (well past threshold)', () => {
    const { container } = render(<SufficiencyBadge weeks={12} muscleName="Glutes" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders [no data] when weeks=0', () => {
    render(<SufficiencyBadge weeks={0} muscleName="Glutes" />);
    expect(screen.getByText(/\[no data\]/)).toBeInTheDocument();
  });

  it('renders [N/8 wks] when 0 < weeks < 8 (denominator visible at-a-glance)', () => {
    render(<SufficiencyBadge weeks={3} muscleName="Glutes" />);
    expect(screen.getByText(/\[3\/8 wks\]/)).toBeInTheDocument();
  });

  it('aria-label expands the [N wks] meaning for screen readers', () => {
    render(<SufficiencyBadge weeks={5} muscleName="Glutes" />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toMatch(/5 of last 8 weeks/);
    expect(btn.getAttribute('aria-label')).toMatch(/Glutes/);
  });

  it('aria-label distinct copy for 0-weeks case', () => {
    render(<SufficiencyBadge weeks={0} muscleName="Glutes" />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toMatch(/no effective sets logged/i);
  });

  it('tap opens explanation sheet', () => {
    render(<SufficiencyBadge weeks={3} muscleName="Glutes" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/Glutes/)).toBeInTheDocument();
    expect(screen.getByText(/8 weeks/i)).toBeInTheDocument();
    expect(screen.getByText(/personalization/i)).toBeInTheDocument();
  });

  it('0-weeks sheet includes "log a session" hint', () => {
    render(<SufficiencyBadge weeks={0} muscleName="Glutes" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/log a session/i)).toBeInTheDocument();
  });
});
