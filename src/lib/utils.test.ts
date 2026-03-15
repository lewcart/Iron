import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('returns empty string with no args', () => {
    expect(cn()).toBe('');
  });

  it('returns single class unchanged', () => {
    expect(cn('text-red-500')).toBe('text-red-500');
  });

  it('joins multiple classes', () => {
    expect(cn('flex', 'items-center', 'gap-4')).toBe('flex items-center gap-4');
  });

  it('ignores falsy values', () => {
    expect(cn('flex', false, null, undefined, 'gap-4')).toBe('flex gap-4');
  });

  it('supports conditional object syntax', () => {
    expect(cn({ 'font-bold': true, 'text-gray-500': false })).toBe('font-bold');
  });

  it('merges conflicting tailwind classes (last wins)', () => {
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('merges conflicting padding classes', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2');
  });

  it('handles array inputs', () => {
    expect(cn(['flex', 'gap-2'])).toBe('flex gap-2');
  });

  it('handles mixed conditional and static classes', () => {
    const isActive = true;
    expect(cn('base-class', isActive && 'active')).toBe('base-class active');
  });
});
