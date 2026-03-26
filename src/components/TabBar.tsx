'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart2, Clock, Plus, Dumbbell, Settings, ClipboardList } from 'lucide-react';

const tabs = [
  { href: '/feed', label: 'Feed', icon: BarChart2 },
  { href: '/history', label: 'History', icon: Clock },
  { href: '/workout', label: 'Workout', icon: Plus },
  { href: '/exercises', label: 'Exercises', icon: Dumbbell },
  { href: '/plans', label: 'Plans', icon: ClipboardList },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-border"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-stretch h-[49px] max-w-lg mx-auto">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href ||
            (href === '/workout' && pathname.startsWith('/workout'));
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center justify-center flex-1 gap-0.5 text-[10px] font-medium transition-colors ${
                active ? 'text-trans-blue' : 'text-muted-foreground'
              }`}
            >
              {active && href === '/workout' ? (
                /* Workout tab — gradient pill when active */
                <div className="gradient-brand rounded-full p-1.5 -mt-0.5">
                  <Icon className="h-5 w-5 text-white" strokeWidth={2.5} />
                </div>
              ) : (
                <Icon
                  className={`h-5 w-5 ${active ? 'text-trans-blue' : ''}`}
                  strokeWidth={active ? 2.5 : 1.75}
                  style={
                    active
                      ? {
                          /* SVG gradient via filter trick — falls back to solid blue */
                          filter: 'none',
                        }
                      : undefined
                  }
                />
              )}
              <span
                className={active ? 'gradient-brand-text font-semibold' : ''}
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
