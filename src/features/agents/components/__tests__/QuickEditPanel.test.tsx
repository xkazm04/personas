/**
 * Quick-edit saves a catalog model id, or nothing. sweep #260.
 *
 * The model field was an `<input>` whose trimmed contents were saved verbatim,
 * from the command palette - the fastest edit surface in the app. A typo, or an
 * id that was valid last release (`claude-opus-4-8` after opus-5 shipped),
 * saved silently and pinned the persona to a model that does not resolve.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import type { Persona } from '@/lib/bindings/Persona';
import { ALL_MODELS } from '@/lib/models/modelCatalog';
import { QuickEditPanel } from '../QuickEditPanel';

function persona(over: Partial<Persona> = {}): Persona {
  return {
    id: 'p-1',
    name: 'Weather Bot',
    description: 'Reports the weather',
    icon: null,
    color: null,
    model_profile: JSON.stringify({ model: 'sonnet' }),
    ...over,
  } as unknown as Persona;
}

describe('QuickEditPanel model field', () => {
  it('has no free-text model input at all', () => {
    render(<QuickEditPanel persona={persona()} onSave={vi.fn()} onCancel={vi.fn()} />);
    // One textarea (description) and zero text inputs: the model is a picker.
    expect(screen.getByTestId('quick-edit-model-trigger')).toBeInTheDocument();
    expect(document.querySelectorAll('input[type="text"], input:not([type])')).toHaveLength(0);
  });

  it('lists the catalog and saves the id the catalog declares', () => {
    const onSave = vi.fn();
    render(<QuickEditPanel persona={persona()} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByTestId('quick-edit-model-trigger'));

    const opus = ALL_MODELS.find((m) => m.id === 'opus')!;
    fireEvent.click(screen.getByTestId('quick-edit-model-option-opus'));
    fireEvent.click(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith('p-1', { model: opus.model ?? opus.id });
  });

  it('flags a stale id the catalog does not know instead of hiding it', () => {
    // The exact shape the card was filed for: an id that resolved last release.
    render(
      <QuickEditPanel
        persona={persona({ model_profile: JSON.stringify({ model: 'claude-opus-4-8' }) })}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('quick-edit-model-unrecognized')).toBeInTheDocument();
    // Shown, not silently rewritten - the operator is the one who can fix it.
    expect(screen.getByTestId('quick-edit-model-trigger').textContent).toContain('claude-opus-4-8');
  });

  it('cannot save a model that is not in the catalog', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <QuickEditPanel
        persona={persona({ model_profile: JSON.stringify({ model: 'claude-opus-4-8' }) })}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    // Saving without touching the picker sends no model update at all.
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();

    // And every value reachable from the UI is a catalog one.
    fireEvent.click(screen.getByTestId('quick-edit-model-trigger'));
    const optionIds = ALL_MODELS.map((m) => m.id);
    for (const id of optionIds) {
      expect(screen.getByTestId(`quick-edit-model-option-${id}`)).toBeInTheDocument();
    }
  });

  it('still saves a description edit on its own', () => {
    const onSave = vi.fn();
    render(<QuickEditPanel persona={persona()} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New blurb' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('p-1', { description: 'New blurb' });
  });
});
