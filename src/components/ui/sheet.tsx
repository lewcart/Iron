'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Height as a CSS value, e.g. "90vh" or "auto". Default "auto". */
  height?: string;
  /** Optional footer pinned to bottom of sheet (e.g. confirm button). */
  footer?: ReactNode;
  className?: string;
}

const DRAG_DISMISS_THRESHOLD = 120;

export function Sheet({ open, onClose, title, children, height = 'auto', footer, className }: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const dragStartY = useRef(0);
  const dragging = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => setVisible(true));
    } else if (mounted) {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 220);
      return () => clearTimeout(t);
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!visible || !sheetRef.current) return;
    const focusable = sheetRef.current.querySelector<HTMLElement>(
      'input, button, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();
  }, [visible]);

  if (!mounted) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    dragging.current = true;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragging.current) return;
    const diff = e.touches[0].clientY - dragStartY.current;
    if (diff > 0) setDragOffset(diff);
  };
  const handleTouchEnd = () => {
    dragging.current = false;
    if (dragOffset >= DRAG_DISMISS_THRESHOLD) {
      onClose();
    }
    setDragOffset(0);
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className={cn(
          'absolute inset-0 bg-black/50 transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0'
        )}
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        className={cn(
          'absolute inset-x-0 bottom-0 bg-background rounded-t-2xl shadow-2xl flex flex-col',
          'transition-transform duration-200 ease-out',
          className
        )}
        style={{
          height,
          maxHeight: '95vh',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          transform: visible
            ? `translateY(${dragOffset}px)`
            : 'translateY(100%)',
        }}
      >
        <div
          className="pt-2 pb-1 cursor-grab"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="mx-auto h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        </div>
        {title && (
          <div className="px-4 pt-1 pb-3 border-b border-border">
            <h2 className="text-base font-semibold">{title}</h2>
          </div>
        )}
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && <div className="border-t border-border p-3">{footer}</div>}
      </div>
    </div>
  );
}
