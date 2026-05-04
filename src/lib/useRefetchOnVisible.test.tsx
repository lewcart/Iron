// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

// Capacitor mocks: default to non-native (web). Per-test we flip Capacitor
// .isNativePlatform() and re-render to exercise the App.appStateChange path.
const isNativePlatformMock = vi.fn(() => false);
const addListenerMock = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatformMock(),
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (...args: unknown[]) => addListenerMock(...args),
  },
}));

import { useRefetchOnVisible } from './useRefetchOnVisible';

afterEach(() => {
  cleanup();
  isNativePlatformMock.mockReset();
  isNativePlatformMock.mockImplementation(() => false);
  addListenerMock.mockReset();
});

describe('useRefetchOnVisible', () => {
  beforeEach(() => {
    // Default: tab visible.
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('does NOT fire on mount', () => {
    const cb = vi.fn();
    renderHook(() => useRefetchOnVisible(cb));
    expect(cb).not.toHaveBeenCalled();
  });

  it('fires the callback on visibilitychange when document becomes visible', () => {
    const cb = vi.fn();
    renderHook(() => useRefetchOnVisible(cb));

    // Simulate hide → show
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(cb).not.toHaveBeenCalled(); // hidden → don't fire

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('removes the visibilitychange listener on unmount', () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useRefetchOnVisible(cb));
    unmount();

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cb).not.toHaveBeenCalled();
  });

  it('subscribes to App.appStateChange on Capacitor native platforms', async () => {
    isNativePlatformMock.mockImplementation(() => true);
    type StateHandler = (s: { isActive: boolean }) => void;
    const handlers: StateHandler[] = [];
    const removeMock = vi.fn();
    addListenerMock.mockImplementation((event: string, handler: StateHandler) => {
      if (event === 'appStateChange') handlers.push(handler);
      return Promise.resolve({ remove: removeMock });
    });

    const cb = vi.fn();
    const { unmount } = renderHook(() => useRefetchOnVisible(cb));

    expect(addListenerMock).toHaveBeenCalledWith('appStateChange', expect.any(Function));

    // Drain the addListener .then() so capCleanup is wired up.
    await Promise.resolve();
    await Promise.resolve();

    expect(handlers.length).toBe(1);

    // Backgrounded — no fire.
    handlers[0]({ isActive: false });
    expect(cb).not.toHaveBeenCalled();

    // Foregrounded — fires.
    handlers[0]({ isActive: true });
    expect(cb).toHaveBeenCalledTimes(1);

    unmount();
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it('uses the latest callback after re-render (effect re-runs when callback identity changes)', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: () => void }) => useRefetchOnVisible(cb), {
      initialProps: { cb: cb1 },
    });

    rerender({ cb: cb2 });

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});
