import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { RESOURCES } from '../scenarios/common';

import { ResponseShape } from './ResponseShape';

/**
 * The shape view.
 *
 * The state worth testing first is the one that looks like a bug and is not: a `204` carries
 * no body at all, and a panel that rendered an empty box for it would teach that something
 * went wrong. The panel says what actually happened instead, so that assertion goes first.
 */

const articles = RESOURCES.find((resource) => resource.name === 'articles');

describe('ResponseShape', () => {
  it('says a missing body is a missing body, not an empty one', () => {
    render(<ResponseShape body={undefined} />);
    expect(screen.getByText(/There is no body at all/)).toBeInTheDocument();
  });

  it('reports a body that is not JSON rather than rendering nothing', () => {
    render(<ResponseShape body={'{ not json'} />);
    expect(screen.getByText(/This body is not JSON/)).toBeInTheDocument();
  });

  it('explains an envelope key on demand, and names it a convention', async () => {
    const user = userEvent.setup();
    render(<ResponseShape body={'{"data": [], "total": 0, "offset": 0, "limit": 5}'} />);

    await user.click(screen.getByRole('button', { name: /^data/ }));

    expect(screen.getByText(/No specification says .data./)).toBeInTheDocument();
    // `data` is a convention and the badge has to say so; `total` beside it is pagination.
    expect(screen.getByText('envelope convention')).toBeInTheDocument();
  });

  it('explains a problem document from its shape, and credits the RFC', async () => {
    const user = userEvent.setup();
    render(
      <ResponseShape
        body={
          '{"type":"about:blank","title":"Not Found","status":404,"detail":"No article with id 9."}'
        }
      />,
    );

    await user.click(screen.getByRole('button', { name: /^type/ }));
    expect(screen.getByText(/URI identifying the problem type/)).toBeInTheDocument();
    expect(screen.getByText('RFC 9457 §3.1.1')).toBeInTheDocument();
  });

  it('prefers the resource’s own definition for its own fields', async () => {
    const user = userEvent.setup();
    if (!articles) throw new Error('the articles resource is missing');

    render(
      <ResponseShape body={'{"id":"1","title":"A","views":4}'} resource={articles} />,
    );

    await user.click(screen.getByRole('button', { name: /^views/ }));
    expect(screen.getByText(/Counted by the server/)).toBeInTheDocument();
    expect(screen.getByText(/422/)).toBeInTheDocument();
  });

  it('walks into nested objects and arrays', () => {
    render(<ResponseShape body={'{"data":[{"id":"1","title":"A"}],"total":1}'} />);

    expect(screen.getByText('1 item')).toBeInTheDocument();
    expect(screen.getByText('[0]')).toBeInTheDocument();
    expect(screen.getByText('"A"')).toBeInTheDocument();
  });

  it('shows null as null rather than as nothing', () => {
    render(<ResponseShape body={'{"next_cursor": null}'} />);
    expect(screen.getByText('null')).toBeInTheDocument();
  });
});
