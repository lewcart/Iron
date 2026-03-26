import { describe, it, expect } from 'vitest';

// ── Tab configuration mirrored from src/components/TabBar.tsx ─────────────────
// TabBar is a 'use client' React component using usePathname, which is not
// available in the node test environment. We test the static tabs configuration
// and the active-state logic in isolation.

/** Main dock tabs (settings is a separate control above the row in TabBar.tsx). */
const tabs = [
  { href: '/feed', label: 'Feed' },
  { href: '/history', label: 'History' },
  { href: '/workout', label: 'Workout' },
  { href: '/exercises', label: 'Exercises' },
  { href: '/plans', label: 'Plans' },
];

/** Mirrors the active-state logic from TabBar.tsx */
function isActive(tabHref: string, pathname: string): boolean {
  return (
    pathname === tabHref ||
    (tabHref === '/workout' && pathname.startsWith('/workout'))
  );
}

// ===== tabs configuration =====

describe('tabs configuration', () => {
  it('defines exactly 5 dock tabs', () => {
    expect(tabs).toHaveLength(5);
  });

  it('includes all required top-level routes', () => {
    const hrefs = tabs.map(t => t.href);
    expect(hrefs).toContain('/feed');
    expect(hrefs).toContain('/history');
    expect(hrefs).toContain('/workout');
    expect(hrefs).toContain('/exercises');
    expect(hrefs).toContain('/plans');
  });

  it('has a non-empty label for every tab', () => {
    for (const tab of tabs) {
      expect(tab.label.length).toBeGreaterThan(0);
    }
  });

  it('has unique hrefs', () => {
    const hrefs = tabs.map(t => t.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('has unique labels', () => {
    const labels = tabs.map(t => t.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('all hrefs start with /', () => {
    for (const tab of tabs) {
      expect(tab.href.startsWith('/')).toBe(true);
    }
  });
});

// ===== isActive logic =====

describe('isActive', () => {
  it('returns true when pathname matches tab href exactly', () => {
    expect(isActive('/feed', '/feed')).toBe(true);
    expect(isActive('/settings', '/settings')).toBe(true);
    expect(isActive('/history', '/history')).toBe(true);
  });

  it('returns false when pathname does not match', () => {
    expect(isActive('/feed', '/settings')).toBe(false);
    expect(isActive('/history', '/feed')).toBe(false);
  });

  it('returns true for /workout when pathname starts with /workout (nested routes)', () => {
    expect(isActive('/workout', '/workout')).toBe(true);
    expect(isActive('/workout', '/workout/123')).toBe(true);
    expect(isActive('/workout', '/workout/new')).toBe(true);
  });

  it('does not apply prefix match to non-workout tabs', () => {
    expect(isActive('/feed', '/feed/123')).toBe(false);
    expect(isActive('/settings', '/settings/profile')).toBe(false);
  });

  it('returns false for /workout prefix when a different tab is checked', () => {
    expect(isActive('/history', '/workout/123')).toBe(false);
  });

  it('returns false when pathname is empty string', () => {
    expect(isActive('/feed', '')).toBe(false);
    expect(isActive('/workout', '')).toBe(false);
  });
});
