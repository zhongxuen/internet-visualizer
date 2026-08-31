import { MODULES } from '@/modules/registry';

/**
 * Placeholder home page. Phase 02 replaces this with the real app shell; it exists now
 * so the scaffold is verifiable end to end and so the registry has a consumer.
 */
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
      <p className="text-accent font-mono text-sm tracking-widest uppercase">
        Phase 01 &middot; scaffolding
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
        Internet Visualizer
      </h1>
      <p className="text-muted mt-4 max-w-2xl text-lg">
        An interactive, visual explanation of how the Internet works. Every module below
        is a deterministic simulation &mdash; nothing here touches a real network.
      </p>

      <h2 className="text-muted mt-14 text-sm font-medium tracking-widest uppercase">
        Modules
      </h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {MODULES.map((module) => (
          <li key={module.id} className="border-border bg-surface rounded-lg border p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-medium">{module.title}</h3>
              <span className="text-muted font-mono text-xs">{module.status}</span>
            </div>
            <p className="text-muted mt-1 text-sm">{module.summary}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
