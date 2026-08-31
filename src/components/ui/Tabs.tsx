'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { focusRing } from './styles';

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  /** Uncontrolled starting tab. Defaults to the first enabled item. */
  defaultTabId?: string;
  /** Controlled selection. Pass with `onTabChange`. */
  tabId?: string;
  onTabChange?: (id: string) => void;
  /** Accessible name for the tab list. */
  label: string;
  className?: string;
  tabListClassName?: string;
}

/**
 * Tabs with roving tabindex: only the selected tab is in the tab order, and
 * Arrow/Home/End move between tabs, skipping disabled ones and wrapping at the ends.
 * Selection follows focus, which is the expected behaviour when panels are cheap.
 */
export function Tabs({
  items,
  defaultTabId,
  tabId,
  onTabChange,
  label,
  className,
  tabListClassName,
}: TabsProps) {
  const baseId = useId();
  const firstEnabled = items.find((item) => !item.disabled)?.id ?? items[0]?.id;
  const [internalId, setInternalId] = useState(defaultTabId ?? firstEnabled);
  const tabRefs = useRef(new Map<string, HTMLButtonElement | null>());

  const selectedId = tabId ?? internalId;

  const select = (id: string) => {
    if (tabId === undefined) setInternalId(id);
    onTabChange?.(id);
  };

  const move = (from: number, step: number) => {
    const count = items.length;
    for (let offset = 1; offset <= count; offset += 1) {
      const next = items[(from + step * offset + count * count) % count];
      if (next && !next.disabled) {
        select(next.id);
        tabRefs.current.get(next.id)?.focus();
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        move(index, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        move(index, -1);
        break;
      case 'Home':
        event.preventDefault();
        move(-1, 1);
        break;
      case 'End':
        event.preventDefault();
        move(items.length, -1);
        break;
      default:
        break;
    }
  };

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div
        role="tablist"
        aria-label={label}
        className={cn('border-border flex items-center gap-1 border-b', tabListClassName)}
      >
        {items.map((item, index) => {
          const isSelected = item.id === selectedId;

          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-controls={`${baseId}-panel-${item.id}`}
              aria-selected={isSelected}
              disabled={item.disabled}
              // Roving tabindex: one stop for the whole tab list.
              tabIndex={isSelected ? 0 : -1}
              ref={(node) => {
                tabRefs.current.set(item.id, node);
              }}
              onClick={() => select(item.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                'disabled:pointer-events-none disabled:opacity-40',
                focusRing,
                isSelected
                  ? 'border-accent text-fg'
                  : 'text-fg-muted hover:text-fg border-transparent',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== selectedId}
          tabIndex={0}
          className={cn('min-h-0 flex-1 pt-4', focusRing)}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
