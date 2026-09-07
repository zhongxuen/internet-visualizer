import Link from 'next/link';
import { isValidElement, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import type { MDXComponents } from 'mdx/types';

import { CodeBlock } from '@/components/ui/CodeBlock';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

/**
 * How markdown becomes this product's typography.
 *
 * Required by `@next/mdx` in the App Router, and it must sit here -- beside `app/` --
 * or every MDX file compiles to components that are undefined at render time.
 *
 * Two rules govern what may go in this file:
 *
 *  1. **Element mappings only.** These are the tags markdown itself emits. Anything a
 *     lesson has to write by hand (`<Quiz>`, `<Term>`, `<KeyTakeaways>`, and from
 *     phase 13.2 `<EmbeddedSim>`) is supplied per-lesson through `LESSON_COMPONENTS`
 *     instead, so the Learning Center's vocabulary stays inside the Learning Center
 *     and this file stays something any future MDX surface can reuse.
 *  2. **Tokens, never values.** The same rule as every other component: colour comes
 *     from `src/styles/tokens.css` through the Tailwind aliases. There is no
 *     typography plugin in this project and there does not need to be one -- a lesson
 *     uses about a dozen tags.
 *
 * The prose measure is set on the elements rather than on a wrapper, because a lesson
 * alternates prose with full-width simulations: constraining the *container* would
 * squeeze the diagrams too, which is backwards for a product whose rule is "prefer
 * visual explanations over long blocks of text".
 */

type Props<T extends keyof React.JSX.IntrinsicElements> = ComponentPropsWithoutRef<T>;

/** Comfortable reading measure. Visual elements opt out simply by not being prose. */
const MEASURE = 'max-w-[68ch]';

/** Internal links get client navigation; everything else is an outbound citation. */
function isInternal(href: string | undefined): href is string {
  return typeof href === 'string' && (href.startsWith('/') || href.startsWith('#'));
}

/**
 * Pull the raw source back out of a fenced code block.
 *
 * MDX hands `pre` a single `code` child whose own child is the literal text and whose
 * `className` is `language-xxx`. `CodeBlock` wants those two as props, so this unwraps
 * one level rather than re-implementing a code block that would drift from the one
 * every module already renders.
 */
function fencedSource(children: ReactNode): { code: string; language?: string } | null {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) {
    return null;
  }

  const { className, children: text } = children.props;
  if (typeof text !== 'string') return null;

  const language = /language-([\w-]+)/.exec(className ?? '')?.[1];
  return { code: text, language };
}

/**
 * The element mappings themselves.
 *
 * Exported as a plain object as well as through the hook below, because the hook may
 * only be called from a component: a test that renders a lesson the way the route does
 * needs to merge these with `LESSON_COMPONENTS` outside one.
 */
export const MDX_ELEMENTS: MDXComponents = {
  /*
   * A lesson's `#` heading is the page's one h1: `LessonLayout` deliberately does not
   * render the title itself, so the MDX file owns the heading hierarchy and there is
   * exactly one place it can be wrong.
   */
  h1: ({ className, ...props }: Props<'h1'>) => (
    <h1
      className={cn(
        'text-fg text-3xl font-semibold tracking-tight text-balance sm:text-4xl',
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }: Props<'h2'>) => (
    <h2
      className={cn(
        'text-fg mt-12 scroll-mt-20 text-xl font-semibold tracking-tight',
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }: Props<'h3'>) => (
    <h3
      className={cn('text-fg mt-8 scroll-mt-20 text-base font-medium', className)}
      {...props}
    />
  ),
  h4: ({ className, ...props }: Props<'h4'>) => (
    <h4
      className={cn('text-fg-secondary mt-6 text-sm font-medium', className)}
      {...props}
    />
  ),

  p: ({ className, ...props }: Props<'p'>) => (
    <p
      className={cn('text-fg-secondary mt-4 leading-relaxed', MEASURE, className)}
      {...props}
    />
  ),

  ul: ({ className, ...props }: Props<'ul'>) => (
    <ul
      className={cn(
        'text-fg-secondary marker:text-fg-muted mt-4 list-disc space-y-2 pl-5 leading-relaxed',
        MEASURE,
        className,
      )}
      {...props}
    />
  ),
  ol: ({ className, ...props }: Props<'ol'>) => (
    <ol
      className={cn(
        'text-fg-secondary marker:text-fg-muted mt-4 list-decimal space-y-2 pl-5 leading-relaxed',
        MEASURE,
        className,
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }: Props<'li'>) => (
    <li className={cn('pl-1', className)} {...props} />
  ),

  strong: ({ className, ...props }: Props<'strong'>) => (
    <strong className={cn('text-fg font-medium', className)} {...props} />
  ),

  a: ({ className, href, ...props }: Props<'a'>) => {
    const classes = cn(
      'text-accent hover:text-accent-strong rounded-sm underline decoration-dotted underline-offset-4 transition-colors',
      focusRing,
      className,
    );

    // An outbound citation (an RFC, a spec) opens in a new tab with the relationship
    // stated; `noreferrer` implies `noopener` in every browser that matters.
    return isInternal(href) ? (
      <Link href={href} className={classes} {...props} />
    ) : (
      <a href={href} target="_blank" rel="noreferrer" className={classes} {...props} />
    );
  },

  /*
   * Inline code only. A fenced block arrives wrapped in a `pre`, which is mapped
   * below and renders `CodeBlock` instead of reaching this.
   */
  code: ({ className, ...props }: Props<'code'>) => (
    <code
      className={cn(
        'border-border bg-surface-raised text-fg rounded border px-1 py-0.5 font-mono text-[0.85em]',
        className,
      )}
      {...props}
    />
  ),

  pre: ({ children, className, ...props }: Props<'pre'>) => {
    const fenced = fencedSource(children);

    // A `pre` whose child is not a plain string is something markdown did not
    // produce; render it as an ordinary block rather than losing it.
    if (!fenced) {
      return (
        <pre className={cn('mt-5', className)} {...props}>
          {children}
        </pre>
      );
    }

    return (
      <CodeBlock
        code={fenced.code}
        language={fenced.language}
        className={cn('mt-5', className)}
      />
    );
  },

  blockquote: ({ className, ...props }: Props<'blockquote'>) => (
    <blockquote
      className={cn(
        'border-accent/50 text-fg-muted mt-5 border-l-2 pl-4 text-sm leading-relaxed italic',
        MEASURE,
        className,
      )}
      {...props}
    />
  ),

  hr: ({ className, ...props }: Props<'hr'>) => (
    <hr className={cn('border-border mt-10 border-t', className)} {...props} />
  ),

  /* GFM tables, used for header lists and wire-format field tables. */
  table: ({ className, ...props }: Props<'table'>) => (
    <div className="border-border mt-5 overflow-x-auto rounded-lg border">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  ),
  th: ({ className, ...props }: Props<'th'>) => (
    <th
      className={cn(
        'border-border text-fg-muted border-b px-3 py-2 text-left text-xs font-medium tracking-wider uppercase',
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }: Props<'td'>) => (
    <td
      className={cn('border-border text-fg-secondary border-b px-3 py-2', className)}
      {...props}
    />
  ),
};

export function useMDXComponents(): MDXComponents {
  return MDX_ELEMENTS;
}
