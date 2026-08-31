import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class names, resolving conflicts so the last class wins.
 * `cn('p-2', condition && 'p-4')` -> `'p-4'` rather than both.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
