import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithPreferences } from '@/components/prefs/testing';

import type { StoryOption } from './stage';
import { StoryPicker } from './StoryPicker';

const told = (
  id: string,
  plainTitle: string,
  extra: Partial<StoryOption> = {},
): StoryOption => ({
  id,
  title: `Technical ${id}`,
  summary: `The technical summary of ${id}.`,
  teaches: [`What ${id} teaches.`],
  story: { plainTitle, question: `What happens in ${id}?`, level: 'beginner' },
  ...extra,
});

const OPTIONS: StoryOption[] = [
  told('first', 'A first visit'),
  told('again', 'Coming back', {
    story: {
      plainTitle: 'Coming back',
      question: 'Why is it faster?',
      level: 'intermediate',
    },
  }),
  { id: 'bare', title: 'No story yet', summary: 'Written before the wave-3 pass.' },
];

/** The row (lg and up). The select below lg renders too, and CSS picks one. */
function row(label = 'Story') {
  return within(screen.getByRole('group', { name: label }));
}

function renderPicker(
  props: Partial<Parameters<typeof StoryPicker>[0]> = {},
  prefs: Parameters<typeof renderWithPreferences>[1] = {},
) {
  const onSelect = vi.fn();
  renderWithPreferences(
    <StoryPicker options={OPTIONS} selectedId="first" onSelect={onSelect} {...props} />,
    prefs,
  );
  return { onSelect };
}

describe('StoryPicker in Simple', () => {
  it('names each story plainly, with its level in words', () => {
    renderPicker();

    const first = row().getByRole('button', { name: /A first visit/ });
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(first).toHaveTextContent('Beginner');
    expect(row().getByRole('button', { name: /Coming back/ })).toHaveTextContent(
      'Intermediate',
    );
  });

  it('asks the chosen story’s question underneath', () => {
    renderPicker({ selectedId: 'again' });
    expect(screen.getByText('Why is it faster?')).toBeInTheDocument();
    expect(screen.queryByText('The technical summary of again.')).toBeNull();
  });

  it('falls back to the title and summary for a story not yet told', () => {
    renderPicker({ selectedId: 'bare' });
    expect(row().getByRole('button', { name: 'No story yet' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Written before the wave-3 pass.')).toBeInTheDocument();
  });

  it('reports a choice from the row and from the select', () => {
    const { onSelect } = renderPicker();

    fireEvent.click(row().getByRole('button', { name: /Coming back/ }));
    expect(onSelect).toHaveBeenLastCalledWith('again');

    fireEvent.change(screen.getByRole('combobox', { name: 'Story' }), {
      target: { value: 'bare' },
    });
    expect(onSelect).toHaveBeenLastCalledWith('bare');
  });
});

describe('StoryPicker in Full detail', () => {
  it('uses the technical titles and the summary, with what the run teaches', () => {
    renderPicker({}, { detail: 'full' });

    expect(row().getByRole('button', { name: 'Technical first' })).toBeInTheDocument();
    expect(screen.getByText('The technical summary of first.')).toBeInTheDocument();

    fireEvent.click(screen.getByText('What this run teaches'));
    expect(screen.getByText('What first teaches.')).toBeInTheDocument();
  });
});

describe('StoryPicker with many stories', () => {
  const many: StoryOption[] = [
    ...['a', 'b', 'c', 'd', 'e'].map((id) => told(id, `Story ${id}`)),
    told('f', 'Story f', { group: 'When things go wrong' }),
    told('g', 'Story g', { group: 'When things go wrong' }),
  ];

  it('shows five, and the rest under "More stories", grouped', () => {
    const { onSelect } = renderPicker({
      options: many,
      selectedId: 'a',
      label: 'Network',
    });

    expect(row('Network').getAllByRole('button', { pressed: false })).toHaveLength(4);
    expect(row('Network').queryByRole('button', { name: /Story f/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More stories' }));
    // Scoped to the menu: the select's <optgroup> is a group by the same name.
    const menu = within(screen.getByRole('dialog', { name: 'More network options' }));
    const overflow = within(menu.getByRole('group', { name: 'When things go wrong' }));
    fireEvent.click(overflow.getByRole('button', { name: /Story g/ }));
    expect(onSelect).toHaveBeenCalledWith('g');
  });

  it('puts groups under their heading in the select', () => {
    const { container } = renderWithPreferences(
      <StoryPicker options={many} selectedId="a" onSelect={vi.fn()} />,
    );
    const group = container.querySelector('optgroup');
    expect(group).toHaveAttribute('label', 'When things go wrong');
    expect(group?.querySelectorAll('option')).toHaveLength(2);
  });

  it('keeps a selected story from the overflow in the row', () => {
    renderPicker({ options: many, selectedId: 'g' });
    expect(row().getByRole('button', { name: /Story g/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('renders nothing with no options', () => {
    const { container } = renderWithPreferences(
      <StoryPicker options={[]} selectedId="x" onSelect={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
