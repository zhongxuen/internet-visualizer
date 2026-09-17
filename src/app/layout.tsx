import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';

import { MotionProvider } from '@/components/motion';
import { PRE_PAINT_SCRIPT, PreferencesProvider } from '@/components/prefs';
import { MAIN_CONTENT_ID, SkipLink, TopNav } from '@/components/shell';
import { rootMetadata } from '@/lib/metadata';
import { getModule } from '@/modules/registry';

import './globals.css';

/*
 * Self-hosted, and read through `--font-sans` / `--font-mono` in ../styles/tokens.css --
 * the variables below are only half the wiring, and without the other half these files
 * are downloaded on every route and never drawn.
 *
 * `swap` with `next/font`'s metric-matched local fallback is the no-layout-shift pair:
 * text is readable in the fallback immediately, and the real face replaces it at the
 * same measured size, so CLS stays at 0.
 */
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

/*
 * The defaults every route inherits -- title template, description, canonical,
 * `metadataBase`, Open Graph, Twitter, and whether this deployment may be indexed at
 * all. Built in `@/lib/metadata` rather than written here, because `moduleMetadata`
 * and the two Learning Center routes have to produce the same shape and there is no
 * way to check that they do if each writes its own object literal.
 *
 * `metadataBase` is what makes every relative URL in that shape resolvable: without it
 * Next warns and falls back to `localhost`, and a production card unfurls with an
 * image nobody outside this machine can fetch.
 */
export const metadata = rootMetadata();

/** The footer's links: the beginner path first, then the one module that can go live. */
const FOOTER_LINKS = [
  { href: '/start', label: 'Start here' },
  { href: '/learn', label: 'Lessons' },
  { href: '/learn/glossary', label: 'Glossary' },
  {
    href: getModule('network-diagnostics')?.route ?? '/network-diagnostics',
    label: 'Network Diagnostics',
  },
] as const;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // `dark` is set here, not toggled: the product is dark-mode-first.
    //
    // `suppressHydrationWarning` because the script below adds `data-detail`,
    // `data-motion` and `data-text-size` to this element before React hydrates it; the
    // DOM is right and the server's attribute list is not. It covers this element's own
    // attributes only, not anything inside it.
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Reads the stored preferences and sets the attributes CSS keys on, before the
          first paint (src/components/prefs/prePaint.ts). Inline scripts are already
          allowed by the policy in src/lib/securityHeaders.ts; this needs no host and
          no 'unsafe-eval'.
        */}
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT_SCRIPT }} />
      </head>
      {/*
        PreferencesProvider keeps those attributes in step after hydration.
        MotionProvider inside it wraps everything: from here on, no component animates
        without going through its `scale()`. It also mirrors the resolved setting onto
        <html> as `data-motion`, which globals.css uses for CSS-only transitions.
      */}
      <body className="flex min-h-full flex-col">
        <PreferencesProvider>
          <MotionProvider>
            {/* First focusable element on the page, before the nav, by design. */}
            <SkipLink />
            <TopNav />

            {/*
              The one `main` landmark. Pages render their content into it and never
              declare their own — `tabIndex={-1}` is what lets the skip link move the
              reading position here.
            */}
            <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1">
              {children}
            </main>

            <footer className="border-border text-fg-muted mt-16 border-t">
              <div className="text-small mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 md:flex-row md:items-center md:justify-between">
                {/*
                  The product's safety posture in one plain line, on every page. It has
                  to be exactly true rather than reassuringly true: Network Diagnostics
                  can reach a real network, so a footer claiming nothing here does would
                  be the sort of ambiguity the safety badges exist to remove.
                */}
                <p className="max-w-prose">
                  Everything here runs in your browser, except Network Diagnostics&rsquo;
                  Live mode, which only runs when you switch it on.
                </p>
                <nav aria-label="Footer">
                  <ul className="flex flex-wrap items-center gap-x-1 gap-y-1">
                    {FOOTER_LINKS.map((link) => (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          className="hover:text-fg focus-visible:outline-focus min-h-target-floor inline-flex items-center rounded-sm px-2 underline-offset-4 transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              </div>
            </footer>
          </MotionProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
