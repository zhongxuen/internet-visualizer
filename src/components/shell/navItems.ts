import type { Level } from '@/core/types/story';

/**
 * The links the navigation shows beside Explore, shared by the bar (`TopNav`) and the
 * phone drawer (`MobileNav`) so the two can never list different things.
 */
export const NAV_LINKS = {
  start: { href: '/start', label: 'Start here' },
  lessons: { href: '/learn', label: 'Lessons' },
  glossary: { href: '/learn/glossary', label: 'Glossary' },
} as const;

/** How a module's level is written wherever it is shown. */
export const LEVEL_LABEL: Record<Level, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export function isActiveRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}
