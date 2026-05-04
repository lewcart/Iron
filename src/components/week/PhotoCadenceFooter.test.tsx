// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PhotoCadenceFooter } from './PhotoCadenceFooter';

afterEach(cleanup);

describe('PhotoCadenceFooter', () => {
  it('renders nothing when state is null (loading)', () => {
    const { container } = render(<PhotoCadenceFooter state={null} hasFrontProjection={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when status=fresh', () => {
    const { container } = render(
      <PhotoCadenceFooter state={{ status: 'fresh', dueIn: 18 }} hasFrontProjection={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders no-photo-ever onboarding copy', () => {
    render(<PhotoCadenceFooter state={{ status: 'no-photo-ever', dueIn: 0 }} hasFrontProjection={false} />);
    expect(screen.getByText(/take your first front-pose photo/i)).toBeInTheDocument();
  });

  it('renders soon copy with day count', () => {
    render(<PhotoCadenceFooter state={{ status: 'soon', dueIn: 6 }} hasFrontProjection={false} />);
    expect(screen.getByText(/front-pose photo due in 6 days/i)).toBeInTheDocument();
  });

  it('renders soon copy with singular day when dueIn=1', () => {
    render(<PhotoCadenceFooter state={{ status: 'soon', dueIn: 1 }} hasFrontProjection={false} />);
    expect(screen.getByText(/due in 1 day$/i)).toBeInTheDocument();
  });

  it('renders soon copy "due today" when dueIn=0', () => {
    render(<PhotoCadenceFooter state={{ status: 'soon', dueIn: 0 }} hasFrontProjection={false} />);
    expect(screen.getByText(/due today/i)).toBeInTheDocument();
  });

  it('renders overdue copy with positive day count', () => {
    render(<PhotoCadenceFooter state={{ status: 'overdue', dueIn: -5 }} hasFrontProjection={false} />);
    expect(screen.getByText(/overdue by 5 days/i)).toBeInTheDocument();
  });

  it('renders overdue singular when 1 day past', () => {
    render(<PhotoCadenceFooter state={{ status: 'overdue', dueIn: -1 }} hasFrontProjection={false} />);
    expect(screen.getByText(/overdue by 1 day$/i)).toBeInTheDocument();
  });

  it('renders Capture link', () => {
    render(<PhotoCadenceFooter state={{ status: 'soon', dueIn: 6 }} hasFrontProjection={false} />);
    const link = screen.getByRole('link', { name: /capture/i });
    expect(link.getAttribute('href')).toBe('/measurements?tab=log&compose=front');
  });

  it('omits Compare projection link when hasFrontProjection=false', () => {
    render(<PhotoCadenceFooter state={{ status: 'overdue', dueIn: -5 }} hasFrontProjection={false} />);
    expect(screen.queryByRole('link', { name: /compare projection/i })).toBeNull();
  });

  it('renders Compare projection link when hasFrontProjection=true', () => {
    render(<PhotoCadenceFooter state={{ status: 'overdue', dueIn: -5 }} hasFrontProjection={true} />);
    const link = screen.getByRole('link', { name: /compare projection/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/measurements?tab=log&compare=front');
  });

  it('Capture link has min-h-[44px] for iOS touch target', () => {
    render(<PhotoCadenceFooter state={{ status: 'soon', dueIn: 6 }} hasFrontProjection={false} />);
    const link = screen.getByRole('link', { name: /capture/i });
    expect(link.className).toMatch(/min-h-\[44px\]/);
  });

  it('overdue uses amber tone (urgency)', () => {
    const { container } = render(
      <PhotoCadenceFooter state={{ status: 'overdue', dueIn: -5 }} hasFrontProjection={false} />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root?.className).toMatch(/amber/);
  });

  it('soon uses muted tone (gentler)', () => {
    const { container } = render(
      <PhotoCadenceFooter state={{ status: 'soon', dueIn: 5 }} hasFrontProjection={false} />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root?.className).not.toMatch(/amber/);
    expect(root?.className).toMatch(/muted/);
  });
});
