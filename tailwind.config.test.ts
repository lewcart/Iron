import { describe, it, expect } from 'vitest';
import config from './tailwind.config';

// ===== brand colour tokens =====

describe('tailwind brand colours', () => {
  const colors = config.theme?.extend?.colors as Record<string, unknown>;

  it('defines trans-blue as #5BCEFA', () => {
    expect(colors['trans-blue']).toBe('#5BCEFA');
  });

  it('defines trans-pink as #F5A9B8', () => {
    expect(colors['trans-pink']).toBe('#F5A9B8');
  });

  it('defines trans-white as #FFFFFF', () => {
    expect(colors['trans-white']).toBe('#FFFFFF');
  });
});

// ===== brand gradients =====

describe('tailwind brand gradients', () => {
  const images = config.theme?.extend?.backgroundImage as Record<string, string>;

  it('defines brand-gradient (blue → pink)', () => {
    expect(typeof images['brand-gradient']).toBe('string');
    expect(images['brand-gradient']).toContain('#5BCEFA');
    expect(images['brand-gradient']).toContain('#F5A9B8');
  });

  it('defines brand-gradient-reverse (pink → blue)', () => {
    expect(typeof images['brand-gradient-reverse']).toBe('string');
    expect(images['brand-gradient-reverse']).toContain('#F5A9B8');
    expect(images['brand-gradient-reverse']).toContain('#5BCEFA');
  });

  it('defines brand-stripe (blue → white → pink)', () => {
    expect(typeof images['brand-stripe']).toBe('string');
    expect(images['brand-stripe']).toContain('#5BCEFA');
    expect(images['brand-stripe']).toContain('#ffffff');
    expect(images['brand-stripe']).toContain('#F5A9B8');
  });

  it('brand-gradient and brand-gradient-reverse are different', () => {
    expect(images['brand-gradient']).not.toBe(images['brand-gradient-reverse']);
  });
});

// ===== content paths =====

describe('tailwind content paths', () => {
  it('includes src/app directory', () => {
    const hasApp = config.content.some(p => p.includes('src/app'));
    expect(hasApp).toBe(true);
  });

  it('includes src/components directory', () => {
    const hasComponents = config.content.some(p => p.includes('src/components'));
    expect(hasComponents).toBe(true);
  });
});

// ===== border radius =====

describe('tailwind border radius', () => {
  const radius = config.theme?.extend?.borderRadius as Record<string, string>;

  it('defines lg, md, and sm radius tokens', () => {
    expect(typeof radius['lg']).toBe('string');
    expect(typeof radius['md']).toBe('string');
    expect(typeof radius['sm']).toBe('string');
  });
});
