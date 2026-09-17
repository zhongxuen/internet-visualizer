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

import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';
import { MODULE_CHAPTERS, modulesInChapter } from '@/modules/registry';

import { MobileNav } from './MobileNav';
import { LEVEL_LABEL, NAV_LINKS, isActiveRoute } from './navItems';
import { SafetyBadge } from './SafetyBadge';
import { SettingsMenu } from './SettingsMenu';

/**
 * Every chapter with its modules, and where each chapter's items start in the flat
 * order the arrow keys walk. The registry is static, so this is worked out once.
 */
const CHAPTERS = MODULE_CHAPTERS.map((chapter) => ({
  chapter,
  modules: modulesInChapter(chapter.key),
}));
const CHAPTER_OFFSETS = CHAPTERS.map((_, i) =>
  CHAPTERS.slice(0, i).reduce((sum, { modules }) => sum + modules.length, 0),
);

interface ExploreMenuProps {
  pathname: string;
}

/**
 * Explore: every module, grouped by the beginner's question it answers
 * (docs/implementation/uiux-spec.md §5.5).
 *
 * A disclosure menu, not a modal, so focus is never trapped: Tab walks straight out of
 * the panel and the menu closes behind it, Escape closes it and hands focus back to the
 * button, and the arrow keys move through every item, across chapters, for people who
 * expect menu semantics.
 */
function ExploreMenu({ pathname }: ExploreMenuProps) {
  // Which pathname the panel was opened on. Navigating away therefore closes it
  // during render — no effect, and no cascading update.
  const [openForPath, setOpenForPath] = useState<string | null>(null);
  const open = openForPath === pathname;
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const active = CHAPTERS.some(({ modules }) =>
    modules.some((m) => isActiveRoute(pathname, m.route)),
  );

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
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close(true);
        }
      }}
      onBlur={(event) => {
        // Focus left the menu entirely — Tab out, or a click elsewhere. A null
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
        className={cn(navItemClasses(active), 'gap-1')}
      >
        Explore
        <ChevronDown
          aria-hidden="true"
          className={cn('size-3.5 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div
          id={panelId}
          role="menu"
          aria-label="Explore"
          className={cn(
            // Anchored to the bar, not to the button: a 44rem panel hanging off the
            // second link runs off the right edge of a 1024px screen.
            'border-border bg-surface-overlay absolute top-full left-4 z-50 rounded-xl border p-3 shadow-2xl sm:left-6',
            'w-[min(28rem,calc(100vw-2rem))] columns-1 gap-4 lg:w-[44rem] lg:columns-2',
            'max-h-[calc(100dvh-5rem)] overflow-y-auto',
          )}
        >
          {CHAPTERS.map(({ chapter, modules }, chapterIndex) => {
            const labelId = `${panelId}-${chapter.key}`;
            return (
              <div
                key={chapter.key}
                role="group"
                aria-labelledby={labelId}
                className="mb-3 break-inside-avoid last:mb-0"
              >
                <span
                  id={labelId}
                  className="text-fg-muted text-caption block px-2 pb-1 font-semibold tracking-wide uppercase"
                >
                  {chapter.label}
                </span>
                {modules.map((module, moduleIndex) => {
                  // Numbered across chapters, so the arrow keys run through the whole menu.
                  const itemIndex = CHAPTER_OFFSETS[chapterIndex]! + moduleIndex;
                  const current = isActiveRoute(pathname, module.route);
                  return (
                    <Link
                      key={module.id}
                      ref={(node) => {
                        itemRefs.current[itemIndex] = node;
                      }}
                      role="menuitem"
                      href={module.route}
                      aria-current={current ? 'page' : undefined}
                      onKeyDown={(event) => onItemKeyDown(event, itemIndex)}
                      className={cn(
                        'flex flex-col gap-0.5 rounded-lg px-2 py-1.5 transition-colors',
                        'hover:bg-surface-raised focus-visible:bg-surface-raised',
                        current && 'bg-surface-raised',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-fg text-small font-medium">
                          {module.title}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {/*
                            The security rule reaches the nav too: a module that can hit a
                            real network says so before you click it, not after.
                          */}
                          {module.usesRealNetwork ? (
                            // `interactive={false}`: this one is inside the link, so it
                            // must not be a tab stop of its own -- see SafetyBadge.
                            <SafetyBadge variant="live" compact interactive={false} />
                          ) : null}
                          <span className="text-fg-muted text-caption">
                            {LEVEL_LABEL[module.level]}
                          </span>
                        </span>
                      </span>
                      <span className="text-fg-secondary text-caption leading-snug">
                        {module.question}
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function navItemClasses(active: boolean) {
  return cn(
    'text-small inline-flex h-9 items-center rounded-md px-3 font-medium whitespace-nowrap transition-colors',
    focusRing,
    active
      ? 'text-fg bg-surface-overlay'
      : 'text-fg-secondary hover:text-fg hover:bg-surface-overlay',
  );
}

export interface TopNavProps {
  className?: string;
}

/**
 * The one navigation surface (docs/implementation/uiux-spec.md §5.5):
 *
 * ```
 * ◈ Internet Visualizer   Start here   Explore ▾   Lessons   Glossary          🔍   ⚙
 * ```
 *
 * Explore is driven entirely by the registry -- chapters from `MODULE_CHAPTERS`, their
 * modules from `modulesInChapter` -- so a new module appears here the moment it is
 * registered and no component ever holds a list of module ids. Under `md` the links fold
 * into a menu button that opens the same items in a `Drawer` (`MobileNav`).
 *
 * `h-14` is load-bearing: the module e2e specs treat the top 56px as covered by this
 * sticky bar when they pick a canvas node to click.
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
      <div className="relative mx-auto flex h-14 w-full max-w-7xl items-center gap-1 px-4 sm:px-6">
        <Link
          href="/"
          aria-current={pathname === '/' ? 'page' : undefined}
          className={cn(
            'hover:bg-surface-overlay mr-1 inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-2 transition-colors',
            focusRing,
          )}
        >
          <Network aria-hidden="true" className="text-accent size-5" />
          <span className="text-fg text-small hidden font-semibold tracking-tight sm:inline">
            Internet Visualizer
          </span>
        </Link>

        <nav aria-label="Main" className="hidden min-w-0 items-center gap-0.5 md:flex">
          <Link href={NAV_LINKS.start.href} className={navItemClasses(false)}>
            {NAV_LINKS.start.label}
          </Link>
          <ExploreMenu pathname={pathname} />
          <Link
            href={NAV_LINKS.lessons.href}
            aria-current={pathname === NAV_LINKS.lessons.href ? 'page' : undefined}
            className={navItemClasses(
              isActiveRoute(pathname, NAV_LINKS.lessons.href) &&
                !isActiveRoute(pathname, NAV_LINKS.glossary.href),
            )}
          >
            {NAV_LINKS.lessons.label}
          </Link>
          <Link
            href={NAV_LINKS.glossary.href}
            aria-current={pathname === NAV_LINKS.glossary.href ? 'page' : undefined}
            className={navItemClasses(isActiveRoute(pathname, NAV_LINKS.glossary.href))}
          >
            {NAV_LINKS.glossary.label}
          </Link>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* Search lands here (UX-4.2). Empty, and taking no space, until then. */}
          <div data-slot="search" className="contents" />
          <SettingsMenu />
          <MobileNav pathname={pathname} className="md:hidden" />
        </div>
      </div>
    </header>
  );
}
