import { cn } from '@/lib/cn';

/** The id the skip link targets, and the id the `main` landmark must carry. */
export const MAIN_CONTENT_ID = 'main-content';

export interface SkipLinkProps {
  className?: string;
}

/**
 * First focusable element on every page (step 7).
 *
 * Off-screen until it takes focus, then pinned to the top-left above everything — see
 * the `.skip-link` rule in `globals.css`. It has to come before the nav in the DOM,
 * because its whole job is to let a keyboard user past it.
 */
export function SkipLink({ className }: SkipLinkProps) {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className={cn(
        'skip-link border-accent bg-surface-overlay text-fg rounded-md border px-3 py-2 text-sm font-medium shadow-lg',
        className,
      )}
    >
      Skip to content
    </a>
  );
}
