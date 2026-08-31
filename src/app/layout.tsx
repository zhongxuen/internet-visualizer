import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { MotionProvider } from '@/components/motion';
import { MAIN_CONTENT_ID, SkipLink, TopNav } from '@/components/shell';

import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'Internet Visualizer',
    template: '%s · Internet Visualizer',
  },
  description:
    'An interactive, visual explanation of how the Internet works -- DNS, HTTP, TLS, TCP/IP and more, as live simulations rather than text.',
};

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
              <p>
                Every module is a deterministic client-side simulation. Nothing here
                contacts a real host.
              </p>
              <p className="font-mono tracking-wide">Internet Visualizer</p>
            </div>
          </footer>
        </MotionProvider>
      </body>
    </html>
  );
}
