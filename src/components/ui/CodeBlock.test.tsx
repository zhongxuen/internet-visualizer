import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CodeBlock } from './CodeBlock';

const REQUEST = ['GET / HTTP/1.1', 'Host: example.com', 'Accept: text/html'].join('\n');

describe('CodeBlock', () => {
  it('renders one node per line, numbers them, and marks highlighted lines', () => {
    const { container } = render(
      <CodeBlock code={REQUEST} language="http" caption="Request" highlightLines={[2]} />,
    );

    expect(screen.getByText('Request')).toBeVisible();
    expect(screen.getByText('http')).toBeVisible();

    const lines = container.querySelectorAll('[data-line]');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveTextContent('GET / HTTP/1.1');

    // Colour is never the only signal: the highlighted line also carries a marker
    // and screen-reader-only text.
    expect(lines[1]).toHaveAttribute('data-highlighted', 'true');
    expect(lines[1]).toHaveTextContent('highlighted:');
    expect(lines[0]).not.toHaveAttribute('data-highlighted');
  });
});
