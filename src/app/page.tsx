import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { ModuleGrid, SafetyBadge } from '@/components/shell';
import { buttonClasses } from '@/components/ui';
import { getModule, MODULES } from '@/modules/registry';

/** The flagship experience the hero points at: type a URL, watch everything happen. */
const FLAGSHIP_ID = 'internet-simulator';

/**
 * Home — the module explorer.
 *
 * One hero line, one primary call to action, then every module in the registry as a
 * card. The grid reads `MODULES` itself, so a new registry entry shows up here with no
 * edit to this file.
 */
export default function Home() {
  const flagship = getModule(FLAGSHIP_ID);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 sm:py-20">
      <section className="max-w-3xl">
        <p className="text-accent font-mono text-xs tracking-widest uppercase">
          See how the Internet works
        </p>
        <h1 className="text-fg mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Watch a request cross the Internet, one layer at a time.
        </h1>
        <p className="text-fg-secondary mt-5 text-lg leading-relaxed text-pretty">
          DNS, TCP, TLS and HTTP are usually explained in paragraphs. Here they are
          animated, steppable, and yours to take apart.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {flagship ? (
            <Link href={flagship.route} className={buttonClasses()}>
              Start with the {flagship.title}
              <ArrowRight aria-hidden="true" className="ml-2 size-4" />
            </Link>
          ) : null}
          <Link
            href="#modules"
            className={buttonClasses({ variant: 'secondary', size: 'md' })}
          >
            Browse all {MODULES.length} modules
          </Link>
        </div>

        {/*
          Stated once, up front, rather than left for the user to infer: the safety
          posture of the whole product. Each card repeats it for its own module.
        */}
        <div className="mt-8 flex items-center gap-3">
          <SafetyBadge variant="simulated" />
          <p className="text-fg-muted text-sm">
            Everything runs in your browser. No packets leave this machine.
          </p>
        </div>
      </section>

      {/* `scroll-mt` clears the sticky header when the hero's second CTA jumps here. */}
      <section
        id="modules"
        aria-labelledby="modules-heading"
        className="mt-16 scroll-mt-20"
      >
        <h2
          id="modules-heading"
          className="text-fg-muted text-xs font-medium tracking-widest uppercase"
        >
          Modules
        </h2>
        <ModuleGrid className="mt-5" />
      </section>
    </div>
  );
}
