import { Geist, Geist_Mono } from 'next/font/google';

import { MotionProvider } from '@/components/motion';
import { MAIN_CONTENT_ID, SkipLink, TopNav } from '@/components/shell';
import { rootMetadata } from '@/lib/metadata';

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

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // `dark` is set here, not toggled: the product is dark-mode-first.
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/*
        MotionProvider wraps everything: from here on, no component animates without
        going through its `scale()`. It also mirrors the resolved setting onto <html>
        as `data-motion`, which globals.css uses for CSS-only transitions.
      */}
      <body className="flex min-h-full flex-col">
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
            <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs sm:px-6">
              {/*
                The product's safety posture in one line, on every page. It has to be
                exactly true rather than reassuringly true: Network Diagnostics can
                reach a real network, so a footer claiming nothing here does would be
                the sort of ambiguity the safety badges exist to remove.
              */}
              <p>
                Every module is a deterministic client-side simulation, except Network
                Diagnostics&rsquo; Live mode &mdash; which is off until you turn it on,
                and says so while it runs.
              </p>
              <p className="font-mono tracking-wide">Internet Visualizer</p>
            </div>
          </footer>
        </MotionProvider>
      </body>
    </html>
  );
}
