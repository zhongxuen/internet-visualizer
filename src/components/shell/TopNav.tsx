'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { ChevronDown, Network } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';
import {
  MODULE_GROUPS,
  modulesInGroup,
  type ModuleGroupMeta,
  type ModuleMeta,
  type ModuleStatus,
} from '@/modules/registry';

import { MotionToggle } from './MotionToggle';
import { SafetyBadge } from './SafetyBadge';

const STATUS_LABEL: Record<ModuleStatus, string> = {
  planned: 'Planned',
  'in-progress': 'In progress',
  ready: 'Ready',
};

const STATUS_TONE = {
  planned: 'pending',
  'in-progress': 'warn',
  ready: 'ok',
} as const;

function isActiveRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

interface NavMenuProps {
  group: ModuleGroupMeta;
  modules: readonly ModuleMeta[];
  pathname: string;
}

/**
 * One nav group as a disclosure menu.
 *
 * Not a modal, so focus is never trapped (step 7): Tab walks straight out of the panel
 * and the menu closes behind it, Escape closes it and hands focus back to the button,
 * and arrows move between items for people who expect menu semantics.
 */
function NavMenu({ group, modules, pathname }: NavMenuProps) {
  // Which pathname the panel was opened on. Navigating away therefore closes it
  // during render — no effect, and no cascading update.
  const [openForPath, setOpenForPath] = useState<string | null>(null);
  const open = openForPath === pathname;
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const groupActive = modules.some((m) => isActiveRoute(pathname, m.route));

  const close = useCallback((returnFocus = false) => {
    setOpenForPath(null);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpenForPath(null);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const focusItem = (index: number) => {
    const items = itemRefs.current.filter((node): node is HTMLAnchorElement => !!node);
    if (items.length === 0) return;
    items[(index + items.length) % items.length]?.focus();
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setOpenForPath(pathname);
    // The panel has not rendered yet on the keystroke that opens it.
    const first = event.key === 'ArrowDown';
    requestAnimationFrame(() => focusItem(first ? 0 : -1));
  };

  const onItemKeyDown = (event: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    const move: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: -1,
    };
    if (!(event.key in move)) return;
    event.preventDefault();
    focusItem(move[event.key]);
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close(true);
        }
      }}
      onBlur={(event) => {
        // Focus left the group entirely — Tab out, or a click elsewhere. A null
        // relatedTarget (focus went to the body) counts as leaving too.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpenForPath(null);
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpenForPath(open ? null : pathname)}
        onKeyDown={onButtonKeyDown}
        className={cn(
          'inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium transition-colors',
          focusRing,
          groupActive
            ? 'text-fg bg-surface-overlay'
            : 'text-fg-secondary hover:text-fg hover:bg-surface-overlay',
        )}
      >
        {group.label}
        <ChevronDown
          aria-hidden="true"
          className={cn('size-3.5 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div
          id={panelId}
          // Below `sm` the panel is anchored to the viewport, not to its button:
          // a 22rem dropdown hanging off the third button in the row runs straight
          // off a phone screen and clips the status badges.
          className="border-border bg-surface-overlay fixed top-14 right-4 left-4 z-50 rounded-xl border p-2 shadow-2xl sm:absolute sm:top-full sm:right-auto sm:left-0 sm:mt-2 sm:w-[min(22rem,calc(100vw-2rem))]"
        >
          <p className="text-fg-muted px-2 pt-1 pb-2 text-xs leading-snug">
            {group.description}
          </p>
          <ul role="menu" aria-label={group.label} className="flex flex-col">
            {modules.map((module, index) => {
              const active = isActiveRoute(pathname, module.route);
              return (
                <li key={module.id} role="none">
                  <Link
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    role="menuitem"
                    href={module.route}
                    aria-current={active ? 'page' : undefined}
                    onKeyDown={(event) => onItemKeyDown(event, index)}
                    className={cn(
                      'flex flex-col gap-1 rounded-lg px-2 py-2 transition-colors',
                      'hover:bg-surface-raised focus-visible:bg-surface-raised',
                      active && 'bg-surface-raised',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-fg text-sm font-medium">{module.title}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {/*
                          The security rule reaches the nav too: a module that can hit a
                          real network says so before you click it, not after.
                        */}
                        {module.usesRealNetwork ? (
                          <SafetyBadge variant="live" compact />
                        ) : null}
                        <Badge tone={STATUS_TONE[module.status]}>
                          {STATUS_LABEL[module.status]}
                        </Badge>
                      </span>
                    </span>
                    <span className="text-fg-muted text-xs leading-snug">
                      {module.summary}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export interface TopNavProps {
  className?: string;
}

/**
 * The one navigation surface, driven entirely by the registry.
 *
 * Groups come from `MODULE_GROUPS` and membership from each entry's `group` field, so
 * a new module appears here the moment it is registered and no component ever holds a
 * list of module ids.
 */
export function TopNav({ className }: TopNavProps) {
  const pathname = usePathname() ?? '/';

  return (
    <header
      className={cn(
        'border-border bg-surface/85 sticky top-0 z-40 border-b backdrop-blur-md',
        className,
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-1 px-4 sm:px-6">
        <Link
          href="/"
          aria-current={pathname === '/' ? 'page' : undefined}
          className={cn(
            'hover:bg-surface-overlay mr-1 inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-2 transition-colors',
            focusRing,
          )}
        >
          <Network aria-hidden="true" className="text-accent size-5" />
          <span className="text-fg hidden text-sm font-semibold tracking-tight sm:inline">
            Internet Visualizer
          </span>
        </Link>

        <nav aria-label="Modules" className="flex min-w-0 items-center gap-0.5">
          {MODULE_GROUPS.map((group) => (
            <NavMenu
              key={group.key}
              group={group}
              modules={modulesInGroup(group.key)}
              pathname={pathname}
            />
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <MotionToggle />
        </div>
      </div>
    </header>
  );
}
