'use client';

import './globals.css';

/**
 * The last boundary: the root layout itself threw, so there is no nav, no footer, and
 * no `next/font` variables -- this file has to be the whole document.
 *
 * Deliberately plain, and deliberately not built out of the design system. Everything
 * in `src/components` renders below the root layout, and the premise of being here is
 * that the root layout did not render, so reaching for a shared component is reaching
 * for something that may be the thing that is broken. The stylesheet is imported for
 * the tokens (`dark` on `<html>` is what selects the palette) and the type falls back
 * to the system stack, because the font variables were declared in the layout that is
 * not here.
 *
 * In practice this should never be seen: the root layout is static markup. It exists so
 * that if it ever is, it is this page rather than the framework's bare default.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="bg-surface text-fg flex min-h-full items-center justify-center p-6">
        <main className="border-border bg-surface-raised w-full max-w-lg rounded-xl border px-6 py-8">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            Internet Visualizer could not start
          </h1>
          <p className="text-fg-secondary mt-3 text-sm leading-relaxed">
            The application shell failed to render, which is a fault in this app and not
            in your connection. Nothing was sent anywhere.
          </p>
          {error.digest ? (
            <p className="text-fg-muted mt-4 font-mono text-xs break-all">
              Digest: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="bg-accent text-accent-ink hover:bg-accent-strong mt-6 inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
