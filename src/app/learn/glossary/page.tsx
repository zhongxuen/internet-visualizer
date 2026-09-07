import type { Metadata } from 'next';

import { Glossary } from '@/modules/learning-center';

export const metadata: Metadata = {
  title: 'Glossary',
  description:
    'Every term the lessons define, with the same wording they use, and links to the lessons and simulations that cover each one.',
};

/**
 * `/learn/glossary`.
 *
 * A static segment, so it wins over the `[track]` dynamic segment beside it -- there is
 * no track called "glossary", and Next resolves the literal first regardless.
 */
export default function GlossaryPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <Glossary />
    </div>
  );
}
