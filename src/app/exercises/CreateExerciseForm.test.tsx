// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const fetchJsonAuthedMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  fetchJsonAuthed: (...args: unknown[]) => fetchJsonAuthedMock(...args),
  apiBase: () => '',
}));

const createCustomExerciseMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/mutations-exercises', () => ({
  createCustomExercise: (...args: unknown[]) => createCustomExerciseMock(...args),
  DuplicateCustomTitleError: class extends Error {},
}));

// MUSCLE_DEFS / MUSCLE_SLUGS are real — let them through.
import CreateExerciseForm from './CreateExerciseForm';

afterEach(cleanup);

describe('CreateExerciseForm — Auto-fill button', () => {
  beforeEach(() => {
    fetchJsonAuthedMock.mockReset();
    createCustomExerciseMock.mockReset();
    createCustomExerciseMock.mockResolvedValue(undefined);
  });

  it('Auto-fill is disabled until title AND a primary muscle are set', () => {
    render(<CreateExerciseForm onClose={vi.fn()} onCreated={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /Auto-fill/i });
    expect(btn).toBeDisabled();

    // Just typing a title isn't enough.
    fireEvent.change(screen.getByPlaceholderText(/Romanian Deadlift/i), {
      target: { value: 'Romanian Deadlift' },
    });
    expect(btn).toBeDisabled();

    // Pick a primary muscle to satisfy the second gate.
    const hamstrings = screen.getAllByRole('button', { name: /Hamstrings/i })[0];
    fireEvent.click(hamstrings);
    expect(btn).not.toBeDisabled();
  });

  it('Auto-fill click POSTs kind=all with all CreateForm fields, fills empty description+steps+tips', async () => {
    fetchJsonAuthedMock.mockResolvedValueOnce({
      description: 'A hip-hinge exercise.',
      steps: ['Plant feet.', 'Hinge.', 'Drive hips.'],
      tips: ["Don't round.", 'Stay close.'],
    });
    render(<CreateExerciseForm onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/Romanian Deadlift/i), {
      target: { value: 'Romanian Deadlift' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /Hamstrings/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /^Auto-fill/i }));

    await waitFor(() => expect(fetchJsonAuthedMock).toHaveBeenCalledTimes(1));
    const [url, opts] = fetchJsonAuthedMock.mock.calls[0];
    expect(url).toBe('/api/exercises/generate-content');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.kind).toBe('all');
    expect(body.exercise.title).toBe('Romanian Deadlift');
    expect(body.exercise.primary_muscles).toContain('hamstrings');
    expect(opts.signal).toBeDefined();

    // Empty fields populated.
    await waitFor(() => {
      expect(screen.getByDisplayValue('A hip-hinge exercise.')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Plant feet.')).toBeInTheDocument();
      expect(screen.getByDisplayValue("Don't round.")).toBeInTheDocument();
    });
  });

  it('Auto-fill does NOT stomp pre-typed description (asymmetric stomp / fill-empties only)', async () => {
    fetchJsonAuthedMock.mockResolvedValueOnce({
      description: 'GENERATED — should NOT replace user input.',
      steps: ['a.', 'b.', 'c.'],
      tips: ['x.', 'y.'],
    });
    render(<CreateExerciseForm onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/Romanian Deadlift/i), {
      target: { value: 'Romanian Deadlift' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /Hamstrings/i })[0]);
    // User typed something into description first.
    fireEvent.change(screen.getByPlaceholderText(/Optional cues/i), {
      target: { value: 'My own description that I typed.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Auto-fill/i }));

    await waitFor(() => expect(fetchJsonAuthedMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      // Steps and tips DID populate (they were empty).
      expect(screen.getByDisplayValue('a.')).toBeInTheDocument();
      expect(screen.getByDisplayValue('x.')).toBeInTheDocument();
    });
    // Description was NOT stomped.
    expect(screen.getByDisplayValue('My own description that I typed.')).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/GENERATED/i)).not.toBeInTheDocument();
  });

  it('Auto-fill error shows inline message under the button', async () => {
    fetchJsonAuthedMock.mockRejectedValueOnce(new Error('upstream blew up'));
    render(<CreateExerciseForm onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/Romanian Deadlift/i), {
      target: { value: 'Push Up' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /Chest/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /^Auto-fill/i }));

    await waitFor(() =>
      expect(screen.getByText(/upstream blew up/i)).toBeInTheDocument(),
    );
  });

  it('Create persists steps and tips to createCustomExercise', async () => {
    fetchJsonAuthedMock.mockResolvedValueOnce({
      description: 'desc',
      steps: ['plant', 'hinge', 'drive'],
      tips: ['no rounding', 'stay close'],
    });
    const onCreated = vi.fn();
    render(<CreateExerciseForm onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByPlaceholderText(/Romanian Deadlift/i), {
      target: { value: 'RDL' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /Hamstrings/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /^Auto-fill/i }));
    await waitFor(() => expect(screen.getByDisplayValue('plant')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Create Exercise/i }));
    await waitFor(() => expect(createCustomExerciseMock).toHaveBeenCalledTimes(1));
    const arg = createCustomExerciseMock.mock.calls[0][0];
    expect(arg.steps).toEqual(['plant', 'hinge', 'drive']);
    expect(arg.tips).toEqual(['no rounding', 'stay close']);
  });
});
