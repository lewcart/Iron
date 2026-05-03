// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WeightEwmaTile } from './WeightEwmaTile';

afterEach(cleanup);

const sampleSeries = Array.from({ length: 10 }, (_, i) => ({
  date: `2026-04-${String(i + 1).padStart(2, '0')}`,
  weight: 67.4 - i * 0.2,
  ewma: 67.3 - i * 0.2,
}));

const sampleRaw = sampleSeries.map(p => ({ date: p.date, weight: p.weight }));

describe('WeightEwmaTile', () => {
  it('C5a: renders smoothed value + delta', () => {
    render(
      <WeightEwmaTile
        data={{
          series: sampleSeries,
          current_ewma: 66.9,
          delta_28d_kg: -0.3,
          raw: sampleRaw,
        }}
      />,
    );
    expect(screen.getByText('66.9')).toBeInTheDocument();
    expect(screen.getByText(/-0\.3 kg \/ 28d/)).toBeInTheDocument();
  });

  it('C5b: raw values hidden by default; toggled by button', () => {
    render(
      <WeightEwmaTile
        data={{
          series: sampleSeries,
          current_ewma: 66.9,
          delta_28d_kg: -0.3,
          raw: sampleRaw,
        }}
      />,
    );
    expect(screen.queryByText('67.4 kg')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show raw values/i }));
    expect(screen.getByText('67.4 kg')).toBeInTheDocument();
  });

  it('shows delta unavailable text when delta_28d_kg is null', () => {
    render(
      <WeightEwmaTile
        data={{
          series: sampleSeries,
          current_ewma: 66.9,
          delta_28d_kg: null,
          raw: sampleRaw,
        }}
      />,
    );
    expect(screen.queryByText(/\/ 28d/)).not.toBeInTheDocument();
  });

  it('aria-label summarizes weight + delta', () => {
    render(
      <WeightEwmaTile
        data={{
          series: sampleSeries,
          current_ewma: 66.9,
          delta_28d_kg: -0.3,
          raw: sampleRaw,
        }}
      />,
    );
    expect(screen.getByLabelText(/Smoothed bodyweight 66\.9 kg/i)).toBeInTheDocument();
  });
});
