import createMDX from '@next/mdx';
import type { NextConfig } from 'next';

/**
 * MDX is on so that phase 13's lessons can be prose with live simulations embedded in
 * it, rather than prose *about* simulations. `.mdx` files are only ever **imported**
 * here -- the lessons live in `src/modules/learning-center/content/lessons/` and are
 * rendered by the `/learn/[track]/[lesson]` route, never by file-based routing -- but
 * `pageExtensions` still lists `mdx` so the two spellings cannot disagree if a lesson
 * is ever promoted to its own page.
 *
 * Plugins are named by string, not imported: Turbopack runs the MDX pipeline in Rust
 * and cannot be handed a JavaScript function (see the Next 16 MDX guide,
 * "Using Plugins with Turbopack"). `remark-gfm` is here for tables and strikethrough,
 * both of which lessons use for wire formats and header lists.
 */
const nextConfig: NextConfig = {
  pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'mdx'],
};

const withMDX = createMDX({
  options: {
    remarkPlugins: ['remark-gfm'],
  },
});

export default withMDX(nextConfig);
