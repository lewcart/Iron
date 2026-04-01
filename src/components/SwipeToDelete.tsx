'use client';

import { useRef, useState, useCallback, type ReactNode } from 'react';

interface SwipeToDeleteProps {
  onDelete: () => void;
  children: ReactNode;
  className?: string;
}

const THRESHOLD = 80;
const DELETE_WIDTH = 80;

export function SwipeToDelete({ onDelete, children, className }: SwipeToDeleteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const currentX = useRef(0);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    currentX.current = 0;
    setSwiping(true);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swiping) return;
    const diff = startX.current - e.touches[0].clientX;
    // Only allow left swipe (positive diff)
    const clamped = Math.max(0, Math.min(diff, DELETE_WIDTH + 20));
    currentX.current = clamped;
    setOffset(clamped);
  }, [swiping]);

  const onTouchEnd = useCallback(() => {
    setSwiping(false);
    if (currentX.current >= THRESHOLD) {
      setOffset(DELETE_WIDTH);
    } else {
      setOffset(0);
    }
  }, []);

  const handleDelete = useCallback(() => {
    setOffset(0);
    onDelete();
  }, [onDelete]);

  const close = useCallback(() => setOffset(0), []);

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className ?? ''}`} onTouchStart={close}>
      {/* Delete background */}
      <div
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-red-500"
        style={{ width: DELETE_WIDTH }}
      >
        <button
          onClick={handleDelete}
          className="w-full h-full flex items-center justify-center text-white text-xs font-semibold"
        >
          Delete
        </button>
      </div>

      {/* Foreground content */}
      <div
        className="relative bg-card"
        style={{
          transform: `translateX(-${offset}px)`,
          transition: swiping ? 'none' : 'transform 0.2s ease-out',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
