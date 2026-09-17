'use client';

import Link from 'next/link';
import { Menu } from 'lucide-react';
import { useState } from 'react';

import { buttonClasses } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';
import { MODULE_CHAPTERS, modulesInChapter } from '@/modules/registry';

import { LEVEL_LABEL, NAV_LINKS, isActiveRoute } from './navItems';
import { SafetyBadge } from './SafetyBadge';

export interface MobileNavProps {
  pathname: string;
  className?: string;
}

/**
 * The navigation under `md`: a menu button that opens the bar's items in a `Drawer`
 * (docs/implementation/uiux-spec.md §5.5). Same links, same chapters, same order.
 *
 * The drawer mounts on first open rather than with the page. Its links are all in the
 * bar's server HTML already, a closed drawer on every route would be a second copy of
 * the whole module list in the document, and its title would be an `h2` sitting above
 * every page's `h1`.
 *
 * Like the Explore menu, it remembers which pathname it was opened on, so following a
 * link inside it closes it during render.
 */
export function MobileNav({ pathname, className }: MobileNavProps) {
  const [openForPath, setOpenForPath] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const open = openForPath === pathname;

  const linkClasses = (active: boolean) =>
    cn(
      'min-h-target text-body flex items-center rounded-md px-3 font-medium transition-colors',
      focusRing,
      active
        ? 'bg-surface-overlay text-fg'
        : 'text-fg-secondary hover:bg-surface-overlay hover:text-fg',
    );

  return (
    <>
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setMounted(true);
          setOpenForPath(pathname);
        }}
        className={buttonClasses({
          variant: 'ghost',
          className: cn('size-target px-0', className),
        })}
      >
        <Menu aria-hidden="true" className="size-5" />
      </button>

      {mounted ? (
        <Drawer
          open={open}
          onClose={() => setOpenForPath(null)}
          title="Menu"
          side="right"
          closeLabel="Close menu"
        >
          <nav aria-label="Menu" className="flex flex-col gap-4">
            <ul className="flex flex-col gap-1">
              {Object.values(NAV_LINKS).map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={pathname === link.href ? 'page' : undefined}
                    className={linkClasses(pathname === link.href)}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>

            {MODULE_CHAPTERS.map((chapter) => (
              <section key={chapter.key} aria-labelledby={`mobile-nav-${chapter.key}`}>
                <h3
                  id={`mobile-nav-${chapter.key}`}
                  className="text-fg-muted text-caption px-3 pb-1 font-semibold tracking-wide uppercase"
                >
                  {chapter.label}
                </h3>
                <ul className="flex flex-col gap-1">
                  {modulesInChapter(chapter.key).map((module) => {
                    const active = isActiveRoute(pathname, module.route);
                    return (
                      <li key={module.id}>
                        <Link
                          href={module.route}
                          aria-current={active ? 'page' : undefined}
                          className={cn(linkClasses(active), 'flex-col items-start py-2')}
                        >
                          <span className="flex w-full items-center justify-between gap-2">
                            <span className="text-fg">{module.title}</span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              {module.usesRealNetwork ? (
                                <SafetyBadge variant="live" compact interactive={false} />
                              ) : null}
                              <span className="text-fg-muted text-caption font-normal">
                                {LEVEL_LABEL[module.level]}
                              </span>
                            </span>
                          </span>
                          <span className="text-fg-secondary text-small font-normal">
                            {module.question}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </nav>
        </Drawer>
      ) : null}
    </>
  );
}
