'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchInputProps {
  value?: string;
  defaultValue?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Debounce in ms. Default 200. */
  debounceMs?: number;
  autoFocus?: boolean;
  className?: string;
  inputClassName?: string;
}

export function SearchInput({
  value: controlled,
  defaultValue = '',
  onChange,
  placeholder = 'Search…',
  debounceMs = 200,
  autoFocus,
  className,
  inputClassName,
}: SearchInputProps) {
  const [internal, setInternal] = useState(controlled ?? defaultValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (controlled !== undefined) setInternal(controlled);
  }, [controlled]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const handleChange = (next: string) => {
    setInternal(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(next), debounceMs);
  };

  const clear = () => {
    setInternal('');
    if (timer.current) clearTimeout(timer.current);
    onChange('');
    inputRef.current?.focus();
  };

  return (
    <div className={cn('relative flex items-center', className)}>
      <Search className="absolute left-3 size-4 text-muted-foreground pointer-events-none" />
      <input
        ref={inputRef}
        type="search"
        inputMode="search"
        value={internal}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full h-11 pl-9 pr-9 rounded-xl bg-muted/40 text-sm placeholder:text-muted-foreground',
          'focus:outline-none focus:ring-2 focus:ring-ring',
          inputClassName
        )}
      />
      {internal && (
        <button
          type="button"
          onClick={clear}
          className="absolute right-2 size-7 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          aria-label="Clear search"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
