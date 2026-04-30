'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/nutrition/today', label: 'Today', match: '/nutrition/today' },
  { href: '/nutrition/week', label: 'Week', match: '/nutrition/week' },
  { href: '/nutrition/history', label: 'History', match: '/nutrition/history' },
  { href: '/nutrition/summary', label: 'Summary', match: '/nutrition/summary' },
];

export function NutritionSubNav() {
  const pathname = usePathname();

  function isActive(match: string): boolean {
    return pathname === match || pathname.startsWith(`${match}/`);
  }

  return (
    <nav
      className="sticky top-0 z-20 backdrop-blur bg-background/80 border-b border-border/30"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="max-w-3xl mx-auto px-4 py-2">
        <div className="flex gap-1 overflow-x-auto scrollbar-none">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                'h-8 px-3 rounded-full text-xs font-semibold inline-flex items-center transition-colors whitespace-nowrap',
                isActive(t.match)
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted/40',
              )}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
