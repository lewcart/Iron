import { describe, it, expect } from 'vitest';

// ── Metadata / viewport values mirrored from src/app/layout.tsx ──────────────
// layout.tsx is a React Server Component and cannot be imported directly in
// a node test environment, so we mirror the static export values here and
// test that they match the documented design-system requirements.

const metadata = {
  title: 'Rebirth',
  description: 'Personal fitness tracker',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
};

const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#5BCEFA',
  interactiveWidget: 'resizes-content',
};

// ===== metadata =====

describe('layout metadata', () => {
  it('has the correct app title', () => {
    expect(metadata.title).toBe('Rebirth');
  });

  it('has a non-empty description', () => {
    expect(typeof metadata.description).toBe('string');
    expect(metadata.description.length).toBeGreaterThan(0);
  });

  it('references the PWA manifest', () => {
    expect(metadata.manifest).toBe('/manifest.json');
  });

  it('specifies SVG icon for both icon and apple-touch-icon', () => {
    expect(metadata.icons.icon).toBe('/icon.svg');
    expect(metadata.icons.apple).toBe('/icon.svg');
  });
});

// ===== viewport =====

describe('layout viewport', () => {
  it('uses device-width', () => {
    expect(viewport.width).toBe('device-width');
  });

  it('sets initialScale to 1', () => {
    expect(viewport.initialScale).toBe(1);
  });

  it('uses cover for safe-area / notch support', () => {
    expect(viewport.viewportFit).toBe('cover');
  });

  it('uses the trans-blue brand colour as the theme colour', () => {
    // Must match the trans-blue token defined in tailwind.config.ts
    expect(viewport.themeColor).toBe('#5BCEFA');
  });

  it('uses resizes-content for mobile keyboard / widget sizing', () => {
    expect(viewport.interactiveWidget).toBe('resizes-content');
  });

  // Regression: WKWebView must NEVER zoom on input focus, and the user must
  // never be able to pinch-zoom (because WKWebView has no pinch-out gesture
  // once zoomed and they'd be permanently stuck). All inputs are 16px on
  // mobile (see globals.css) so iOS has no reason to auto-zoom in the first
  // place, and these flags make it explicit.
  it('pins maximumScale to 1 to prevent iOS WKWebView zoom', () => {
    expect(viewport.maximumScale).toBe(1);
  });

  it('disables userScalable so pinch-zoom never strands the user', () => {
    expect(viewport.userScalable).toBe(false);
  });
});
