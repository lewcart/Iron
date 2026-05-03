// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { EditableTextSection } from './EditableTextSection';

afterEach(cleanup);

describe('EditableTextSection — Sparkles render gating', () => {
  it('renders Sparkles when onMagicGenerate is provided AND editable', () => {
    render(
      <EditableTextSection
        mode="numbered-list"
        label="Steps"
        value={['existing step']}
        editable
        onSave={vi.fn().mockResolvedValue(undefined)}
        onMagicGenerate={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Generate Steps with AI/i)).toBeInTheDocument();
  });

  it('hides Sparkles when onMagicGenerate is omitted', () => {
    render(
      <EditableTextSection
        mode="numbered-list"
        label="Steps"
        value={['existing']}
        editable
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.queryByLabelText(/Generate Steps with AI/i)).not.toBeInTheDocument();
    // Pencil still rendered though.
    expect(screen.getByLabelText(/Edit Steps/i)).toBeInTheDocument();
  });

  it('hides Sparkles when editable=false (modal chrome)', () => {
    render(
      <EditableTextSection
        mode="numbered-list"
        label="Steps"
        value={['existing']}
        editable={false}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onMagicGenerate={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/Generate Steps with AI/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Edit Steps/i)).not.toBeInTheDocument();
  });
});

describe('EditableTextSection — magic click flow', () => {
  it('clicking Sparkles enters edit mode + populates the draft on success', async () => {
    const generate = vi.fn().mockResolvedValue(['new step 1', 'new step 2', 'new step 3']);
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <EditableTextSection
        mode="numbered-list"
        label="Steps"
        value={[]}
        editable
        onSave={save}
        onMagicGenerate={generate}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Generate Steps with AI/i));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    // Editor is now in edit mode showing the generated drafts.
    await waitFor(() => {
      expect(screen.getByDisplayValue('new step 1')).toBeInTheDocument();
      expect(screen.getByDisplayValue('new step 2')).toBeInTheDocument();
      expect(screen.getByDisplayValue('new step 3')).toBeInTheDocument();
    });
  });

  it('shows inline error when generator throws', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('OpenAI down'));
    render(
      <EditableTextSection
        mode="numbered-list"
        label="Steps"
        value={[]}
        editable
        onSave={vi.fn().mockResolvedValue(undefined)}
        onMagicGenerate={generate}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Generate Steps with AI/i));
    await waitFor(() => expect(screen.getByText(/OpenAI down/i)).toBeInTheDocument());
  });
});

describe('EditableTextSection — abort on cancel', () => {
  it('Cancel button aborts the generator AbortSignal', async () => {
    let receivedSignal: AbortSignal | null = null;
    const generate = vi.fn().mockImplementation((signal: AbortSignal) => {
      receivedSignal = signal;
      return new Promise(() => {/* never resolves */});
    });
    render(
      <EditableTextSection
        mode="prose"
        label="About"
        value={null}
        editable
        onSave={vi.fn().mockResolvedValue(undefined)}
        onMagicGenerate={generate}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Generate About with AI/i));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(receivedSignal).not.toBeNull();
    expect(receivedSignal!.aborted).toBe(false);

    fireEvent.click(screen.getByLabelText(/Cancel/i));
    expect(receivedSignal!.aborted).toBe(true);
  });
});

describe('EditableTextSection — offline gating', () => {
  let originalDescriptor: PropertyDescriptor | undefined;
  beforeEach(() => {
    originalDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
  });
  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(window.navigator, 'onLine', originalDescriptor);
    }
  });

  it('disables Sparkles + uses "Magic needs internet" label when offline', () => {
    render(
      <EditableTextSection
        mode="numbered-list"
        label="Steps"
        value={[]}
        editable
        onSave={vi.fn().mockResolvedValue(undefined)}
        onMagicGenerate={vi.fn()}
      />,
    );
    const btn = screen.getByLabelText(/Magic needs internet/i);
    expect(btn).toBeDisabled();
  });
});
