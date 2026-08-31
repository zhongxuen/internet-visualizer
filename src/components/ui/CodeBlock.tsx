import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { focusRing } from './styles';

export interface CodeBlockProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'children' | 'title'
> {
  code: string;
  /** Shown in the header, e.g. `http`, `dns`. Purely a label — no highlighting yet. */
  language?: string;
  caption?: ReactNode;
  /** 1-based line numbers to call out. */
  highlightLines?: number[];
  showLineNumbers?: boolean;
}

/**
 * Monospace block for packet headers and request/response text.
 *
 * Highlighted lines carry three signals, not just colour: a left border, a `▸` marker
 * in the gutter, and screen-reader-only text.
 */
export function CodeBlock({
  code,
  language,
  caption,
  highlightLines,
  showLineNumbers = true,
  className,
  ...props
}: CodeBlockProps) {
  const lines = code.replace(/\n$/, '').split('\n');
  const highlighted = new Set(highlightLines ?? []);

  return (
    <figure
      className={cn(
        'border-border bg-surface-raised overflow-hidden rounded-lg border',
        className,
      )}
      {...props}
    >
      {caption || language ? (
        <figcaption className="border-border text-fg-muted flex items-center justify-between gap-3 border-b px-4 py-2 text-xs">
          <span>{caption}</span>
          {language ? (
            <span className="font-mono tracking-wider uppercase">{language}</span>
          ) : null}
        </figcaption>
      ) : null}

      <pre
        tabIndex={0}
        className={cn('overflow-x-auto py-3 text-sm leading-relaxed', focusRing)}
      >
        <code className="block font-mono">
          {lines.map((line, index) => {
            const lineNumber = index + 1;
            const isHighlighted = highlighted.has(lineNumber);

            return (
              <span
                key={lineNumber}
                data-line={lineNumber}
                data-highlighted={isHighlighted || undefined}
                className={cn(
                  'flex border-l-2 border-transparent px-3',
                  isHighlighted && 'border-accent bg-accent/10',
                )}
              >
                {isHighlighted ? <span className="sr-only">highlighted: </span> : null}
                {showLineNumbers ? (
                  <span
                    aria-hidden="true"
                    className="text-fg-muted mr-4 shrink-0 tabular-nums select-none"
                  >
                    <span className="text-accent inline-block w-3">
                      {isHighlighted ? '\u25B8' : ''}
                    </span>
                    <span className="inline-block w-6 text-right">{lineNumber}</span>
                  </span>
                ) : null}
                <span className="text-fg-secondary whitespace-pre">
                  {line === '' ? '\u00A0' : line}
                </span>
              </span>
            );
          })}
        </code>
      </pre>
    </figure>
  );
}
