// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TileEmptyState } from './TileEmptyState';

afterEach(cleanup);

describe('TileEmptyState', () => {
  it('D1: renders message + tappable fix link', () => {
    render(<TileEmptyState message="Need 4 more weigh-ins" fixHref="/measurements" fixLabel="Log weigh-in" />);
    expect(screen.getByText('Need 4 more weigh-ins')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /log weigh-in/i });
    expect(link).toBeInTheDocument();
  });

  it('D2: link href matches the fixHref prop', () => {
    render(<TileEmptyState message="x" fixHref="/strategy" fixLabel="Set vision" />);
    const link = screen.getByRole('link', { name: /set vision/i });
    expect(link.getAttribute('href')).toBe('/strategy');
  });

  it('D3: omits link when fixHref not provided', () => {
    render(<TileEmptyState message="just a message" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('default fix label is "Fix this"', () => {
    render(<TileEmptyState message="x" fixHref="/y" />);
    expect(screen.getByRole('link', { name: /fix this/i })).toBeInTheDocument();
  });

  it('renders status role for assistive tech', () => {
    render(<TileEmptyState message="hi" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
