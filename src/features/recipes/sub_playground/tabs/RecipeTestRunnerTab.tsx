import { useState, useCallback, useMemo } from 'react';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import { useRecipeTestRunner } from '../libs/useRecipeTestRunner';
import { parseInputSchema, parseMockValues } from './recipeTestHelpers';
import { RecipeInputSection } from './RecipeInputSection';
import { RecipeOutputSection } from './RecipeOutputSection';

interface RecipeTestRunnerTabProps {
  recipe: RecipeDefinition;
}

export function RecipeTestRunnerTab({ recipe }: RecipeTestRunnerTabProps) {
  const { fields, parseError } = useMemo(() => parseInputSchema(recipe.input_schema), [recipe.input_schema]);
  const mockValues = useMemo(() => parseMockValues(recipe.sample_inputs), [recipe.sample_inputs]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const f of fields) {
      defaults[f.key] = String(f.default ?? '');
    }
    return defaults;
  });
  const [freeInput, setFreeInput] = useState('');

  const {
    running, result, error, execute,
    executionPhase, executionLines, llmOutput, executionError,
  } = useRecipeTestRunner(recipe);

  const handleFieldChange = useCallback((key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleExecute = useCallback(async () => {
    let inputData: Record<string, unknown>;
    if (fields.length > 0) {
      inputData = { ...fieldValues };
    } else if (freeInput.trim()) {
      try {
        inputData = JSON.parse(freeInput);
      } catch {
        inputData = { input: freeInput };
      }
    } else {
      inputData = {};
    }
    await execute(inputData);
  }, [fields, fieldValues, freeInput, execute]);

  return (
    <div className="flex flex-col h-full">
      <RecipeInputSection
        recipe={recipe}
        fields={fields}
        fieldValues={fieldValues}
        onFieldChange={handleFieldChange}
        freeInput={freeInput}
        onFreeInputChange={setFreeInput}
        mockValues={mockValues}
        running={running}
        executionPhase={executionPhase}
        onExecute={handleExecute}
        onSetFieldValues={setFieldValues}
        schemaParseError={parseError}
      />

      <RecipeOutputSection
        result={result}
        running={running}
        llmOutput={llmOutput}
        executionPhase={executionPhase}
        executionLines={executionLines}
        error={error}
        executionError={executionError}
      />
    </div>
  );
}
