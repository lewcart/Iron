'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart2, Plus, Pill, Ruler, Utensils } from 'lucide-react';
import { prefetchMainTabData } from '@/lib/api/prefetch';

const tabs = [
  { href: '/feed', label: 'Feed', icon: BarChart2 },
  { href: '/hrt', label: 'HRT', icon: Pill },
  { href: '/workout', label: 'Workout', icon: Plus },
  { href: '/measurements', label: 'Measure', icon: Ruler },
  { href: '/nutrition', label: 'Nutrition', icon: Utensils },
];

export function TabBar() {
  const pathname = usePathname();
  const queryClient = useQueryClient();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-t border-border"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      <div
        className="flex items-stretch max-w-lg mx-auto"
        style={{ height: 'var(--tab-bar-inner-height)' }}
      >
        {tabs.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href ||
            (href === '/workout' && pathname.startsWith('/workout'));
          return (
            <Link
              key={href}
              href={href}
              prefetch
              onPointerEnter={() => prefetchMainTabData(queryClient, href)}
              onFocus={() => prefetchMainTabData(queryClient, href)}
              className={`flex flex-col items-center justify-center flex-1 min-h-0 min-w-0 gap-0.5 text-[10px] font-medium transition-colors ${
                active ? 'text-trans-blue' : 'text-muted-foreground'
              }`}
            >
              <div className="flex h-8 w-full shrink-0 items-center justify-center">
                {active && href === '/workout' ? (
                  <div className="gradient-brand rounded-full p-1.5">
                    <Icon className="h-5 w-5 text-white" strokeWidth={2.5} />
                  </div>
                ) : (
                  <Icon
                    className={`h-5 w-5 ${active ? 'text-trans-blue' : ''}`}
                    strokeWidth={active ? 2.5 : 1.75}
                    style={
                      active
                        ? {
                            filter: 'none',
                          }
                        : undefined
                    }
                  />
                )}
              </div>
              <span
                className={`leading-none ${active ? 'gradient-brand-text font-semibold' : ''}`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
