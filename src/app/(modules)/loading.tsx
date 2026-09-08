import { ModuleSkeleton } from '@/components/shell';

/**
 * The skeleton every module route shows while its code is on the way.
 *
 * It sits inside `(modules)/layout.tsx`, which resolves the module from the URL, so the
 * title, summary, topics and safety badge are already real and only the simulation
 * itself is pending. That is the whole reason this file is one line: the chrome is not
 * a thing to fake.
 *
 * It is worth having even though every module page is statically rendered. The wait
 * being covered is not a data fetch -- it is the module's JavaScript, which is the
 * largest thing on the route (see the bundle notes in CLAUDE.md), and on a client-side
 * navigation there is nothing on screen until it arrives.
 */
export default function ModuleLoading() {
  return <ModuleSkeleton />;
}
