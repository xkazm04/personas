import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { useEffect } from 'react';
import { useCredentialImport } from '../useCredentialImport';
import { ImportInputPhase } from '../ImportInputPhase';

// A Parse that finds no secrets sets useCredentialImport().error and stays on
// the input phase. Nothing rendered that error, so the click did nothing
// visible: the user could not tell a bad paste from a dead button.

function Harness() {
  const flow = useCredentialImport();
  const { selectSource } = flow;
  useEffect(() => { selectSource('1password'); }, [selectSource]);
  if (flow.phase !== 'input' || !flow.sourceId) return <p>phase:{flow.phase}</p>;
  return (
    <ImportInputPhase
      sourceId={flow.sourceId}
      rawInput={flow.rawInput}
      onInputChange={flow.setRawInput}
      onParse={flow.parse}
      onBack={flow.goBack}
      error={flow.error}
    />
  );
}

describe('ImportInputPhase shows why a parse found nothing', () => {
  it('a 1Password paste that is not JSON surfaces the parser error as an alert', () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'not json at all' } });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /parse/i })); });
    expect(screen.getByRole('alert').textContent).toMatch(/Failed to parse 1Password JSON/);
  });

  it('the credential design modal hands the flow error to the input phase', () => {
    const src = readFileSync(
      join(__dirname, '../../../../sub_catalog/components/design/CredentialDesignModalBody.tsx'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const block = src.slice(src.indexOf('<ImportInputPhase'), src.indexOf('/>', src.indexOf('<ImportInputPhase')));
    expect(block).toMatch(/error=\{importFlow\.error\}/);
  });
});
