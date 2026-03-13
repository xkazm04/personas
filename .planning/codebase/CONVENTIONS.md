# Coding Conventions

**Analysis Date:** 2026-03-13

## Naming Patterns

**Files:**
- Components: PascalCase with `.tsx` extension
  - Example: `ChatCreator.tsx`, `FormField.tsx`, `DatabaseCard.tsx`
- Utilities/Helpers: camelCase with `.ts` extension
  - Example: `tauriInvoke.ts`, `builderHelpers.ts`, `labUtils.ts`
- API layer: camelCase with descriptive names
  - Example: `personas.ts`, `credentials.ts`, `messages.ts`
- Store slices: [domain]Slice.ts pattern
  - Example: `personaSlice.ts`, `credentialSlice.ts`, `executionSlice.ts`
- Test files: `__tests__/[ComponentName].test.tsx` or `[filename].test.ts`
  - Example: `src/stores/__tests__/databaseSlice.test.ts`, `src/features/vault/sub_databases/__tests__/DatabaseCard.test.tsx`

**Functions:**
- camelCase for all function names
- Verbs for actions: `fetch*`, `create*`, `update*`, `delete*`, `handle*`, `use*`
- Examples: `listPersonas`, `getPersonaDetail`, `fetchPersonaSummaries`, `handleSend`

**Variables:**
- camelCase for local variables and parameters
- UPPER_SNAKE_CASE for constants
- Examples of constants: `STARTER_PROMPTS`, `DEGRADATION_THRESHOLD`, `WIZARD_STEPS`
- Boolean variables prefixed with `is`, `has`, or `should`
  - Examples: `isLoading`, `hasError`, `shouldUpdate`

**Types and Interfaces:**
- PascalCase for all types, interfaces, and enums
- Use `I` prefix only when explicitly needed for disambiguation
- Examples: `FormFieldProps`, `PersonaSlice`, `DegradationCategory`, `PersonaDetailResponse`

**React Components:**
- PascalCase function names
- Props interfaces named `[ComponentName]Props`
- Example:
  ```typescript
  interface ChatCreatorProps {
    onCancel?: () => void;
    onCreated?: (id: string) => void;
  }
  export function ChatCreator({ onCancel, onCreated }: ChatCreatorProps) { }
  ```

## Code Style

**Formatting:**
- Tool: None enforced at runtime (no Prettier config detected)
- Target: ES2021 JavaScript
- Line length: Typical files stay under 100-120 characters
- Indentation: 2 spaces (observed in all TSX and TS files)

**Linting:**
- Tool: ESLint with `@typescript-eslint` rules
- Config: `eslint.config.js` (modern ESLint flat config format)
- Key rules enforced:
  - `@typescript-eslint/no-unused-vars` with exceptions:
    - Variables starting with `_` are ignored (use `_variable` for intentionally unused parameters)
    - Function parameters starting with `_` are ignored
    - Destructured array elements starting with `_` are ignored
  - `custom/enforce-base-modal`: Custom rule warns when components don't extend `BaseModal`
  - `js.configs.recommended` and `typescript-eslint.configs.recommended` applied

**Import Organization:**

1. External packages from `node_modules`:
   ```typescript
   import { motion } from 'framer-motion';
   import { MessageCircle, Send } from 'lucide-react';
   ```

2. React and built-in packages:
   ```typescript
   import { useId, type ReactNode } from 'react';
   import { useState } from 'react';
   ```

3. Project internal imports (using `@` alias):
   ```typescript
   import { invoke } from "@tauri-apps/api/core";
   import { Button } from '@/features/shared/components/buttons';
   import { useAgentStore } from "@/stores/agentStore";
   import type { Persona } from "@/lib/bindings/Persona";
   ```

4. Blank line separates external from internal imports

5. `type` imports are used for TypeScript-only imports to prevent circular dependencies:
   ```typescript
   import type { ReactNode } from 'react';
   import type { Persona } from "@/lib/bindings/Persona";
   ```

**Path Aliases:**
- `@` maps to `src/` directory
- Configured in both `vite.config.ts` and `tsconfig.json`
- Always use `@` alias for internal imports, never relative paths

## Error Handling

**Patterns:**

Error handling follows a centralized, structured approach:

1. **Error Categorization:**
   - Network errors detected by regex: `/network|fetch|connection|ECONNREFUSED|ERR_NETWORK/i`
   - Timeout errors: `/timeout|timed out|deadline|ETIMEDOUT/i`
   - Validation errors: `/validation|invalid|malformed|parse/i`
   - Unknown category as fallback
   - Example from `src/stores/slices/agents/personaSlice.ts`:
   ```typescript
   type DegradationCategory = 'network' | 'timeout' | 'validation' | 'unknown';

   function categorizeError(err: unknown): DegradationCategory {
     const msg = err instanceof Error ? err.message : String(err);
     if (/network|fetch|connection|ECONNREFUSED|ERR_NETWORK/i.test(msg)) return 'network';
     if (/timeout|timed out|deadline|ETIMEDOUT/i.test(msg)) return 'timeout';
     if (/validation|invalid|malformed|parse/i.test(msg)) return 'validation';
     return 'unknown';
   }
   ```

2. **Unified Error Reporting (`reportError` helper):**
   - Located in `src/stores/storeTypes.ts`
   - Updates store state AND fires toast notifications
   - Accepts error with fallback message and severity level
   - Example usage in store slices:
   ```typescript
   catch (err) {
     reportError(err, "Failed to fetch personas", set, { stateUpdates: { isLoading: false } });
     throw err;
   }
   ```

3. **Error Message Extraction (`errMsg` helper):**
   - Located in `src/stores/storeTypes.ts`
   - Extracts message from Error objects or object properties
   - Falls back to string conversion
   ```typescript
   export function errMsg(err: unknown, fallback: string): string {
     if (err instanceof Error) return err.message;
     if (typeof err === "object" && err !== null && "error" in err) return String((err as any).error);
     return fallback;
   }
   ```

4. **Async Error Handling in Effects:**
   - Fire-and-forget async operations use void with `.catch()` for logging
   - Example:
   ```typescript
   void runMiddleware('finalize_status', payload, trace).catch((err) => {
     console.warn('[execution] finalize_status middleware failed:', err);
   });
   ```

5. **Try/Catch Pattern:**
   - Always set loading state to false in finally or catch handlers
   - Always throw error after reporting for upstream handling when appropriate
   - Example:
   ```typescript
   try {
     const data = await fetchData();
     set({ data, isLoading: false });
   } catch (err) {
     reportError(err, "Failed to fetch", set, { stateUpdates: { isLoading: false } });
     throw err;
   }
   ```

## Logging

**Framework:** `console` object (no dedicated logging library)

**Patterns:**
- Use `console.warn()` for non-fatal issues with context prefix
  - Example: `console.warn('[execution] finalize_status middleware failed:', err)`
- Use `console.error()` for critical errors
- Context prefixes enclosed in square brackets: `[domain]` or `[module]`
- Log structure: `[context] message: details`

## Comments

**When to Comment:**

1. **JSDoc/TSDoc for public APIs:**
   - Comment all exported functions, interfaces, and types
   - Include parameter descriptions and return type documentation
   - Example from `src/features/shared/components/forms/FormField.tsx`:
   ```typescript
   /**
    * Shared wrapper that unifies the label + input + error/help-text pattern
    * used across all forms. Standardises spacing, label styling, required
    * indicator, and wires `aria-invalid` / `aria-describedby` for a11y.
    */
   export function FormField({ ... }: FormFieldProps) { }
   ```

2. **JSDoc/TSDoc for Props interfaces:**
   - Document each prop with `/** */` comment
   - Include default behavior if not obvious
   - Include code examples in multi-line descriptions when helpful
   ```typescript
   export interface FormFieldProps {
     /** Visible label text. */
     label: string;
     /** Show a red asterisk after the label. */
     required?: boolean;
     /**
      * Either a plain ReactNode **or** a render-prop that receives accessible
      * input props (`id`, `aria-invalid`, `aria-describedby`).
      *
      * Prefer the render-prop form so that the input is automatically wired to
      * the label and error text:
      *
      * ```tsx
      * <FormField label="Name" error={err}>
      *   {(inputProps) => <input {...inputProps} />}
      * </FormField>
      * ```
      */
     children: ReactNode | ((inputProps: FormFieldInputProps) => ReactNode);
   }
   ```

3. **Section Dividers for logical grouping:**
   - Use separator comments for large blocks of related logic
   - Format: `// -- [Section Name] [dashes to fill 80 chars]`
   - Example:
   ```typescript
   // -- Error categorization for structured degradation events ------------------
   type DegradationCategory = 'network' | 'timeout' | 'validation' | 'unknown';
   ```

4. **Inline comments for non-obvious logic:**
   - Explain WHY, not WHAT (the code shows what it does)
   - Use sparingly when the code intent is unclear
   - Example:
   ```typescript
   // Validate persisted selection -- clear if the persona was deleted
   const stillExists = state.selectedPersonaId == null ||
     personas.some((p) => p.id === state.selectedPersonaId);
   ```

5. **REST endpoint documentation:**
   - Document API calls with comments describing the batched response structure
   - Example from `src/api/agents/personas.ts`:
   ```typescript
   /** Batched persona detail returned by the single `get_persona_detail` IPC command. */
   export interface PersonaDetailResponse extends Persona {
     tools: PersonaToolDefinition[];
     triggers: PersonaTrigger[];
     subscriptions: PersonaEventSubscription[];
     automations: PersonaAutomation[];
   }
   ```

**JSDoc/TSDoc:**
- Use `@param` and `@returns` for function documentation
- Use `` ``` `` code blocks for examples
- Use markdown **bold** for emphasis in descriptions
- Document the "why" behind decisions when not obvious

## Function Design

**Size Guidelines:**
- Typical functions are 30-80 lines
- Components rarely exceed 150 lines
- Hooks stay under 100 lines (longer ones split into sub-hooks)
- If a function exceeds 150 lines, consider breaking it into smaller pieces

**Parameters:**
- Prefer object parameters (destructuring) for functions with 3+ arguments
- Example:
  ```typescript
  // Good:
  function createPersona(input: { name: string; description: string; system_prompt: string }) { }

  // Avoid:
  function createPersona(name: string, description: string, system_prompt: string) { }
  ```

**Return Values:**
- Async functions always return `Promise<T>`
- Functions that might fail return values with null/undefined or union types
- Example: `invoke<PersonaDetailResponse | null>("get_detail")`
- Prefer explicit return types on all functions

## Module Design

**Exports:**
- Use named exports for all components, functions, and types
- Use `export` directly on declarations when possible
- Avoid `export *` (use explicit barrel files instead)
- Example:
  ```typescript
  export function ChatCreator({ ... }: ChatCreatorProps) { }
  export interface ChatCreatorProps { }
  ```

**Barrel Files (index.ts):**
- Use barrel files to group related exports from a feature directory
- Located in feature root: `src/features/[feature]/index.ts`
- Export only public API, hide internal components
- Example from `src/features/agents/sub_design/index.ts`:
  ```typescript
  export { DesignTab } from './DesignTab';
  export { DesignWizard } from './wizard/DesignWizard';
  export { useDesignTabState } from './libs/useDesignTabState';
  export type { WizardStep, WizardQuestion } from './wizard/wizardSteps';
  ```

**Module Organization:**
- API layer (`src/api/`): IPC invocation wrappers, Tauri command calls
- Store layer (`src/stores/`): Zustand slices and composite stores
- Feature layer (`src/features/`): React components organized by domain
- Hooks layer (`src/hooks/`): Custom React hooks, prefixed with `use`
- Utilities (`src/lib/`): Type definitions, helper functions, constants
- Each feature has a `components/` subdirectory for React components
- Each feature has a `libs/` subdirectory for hooks and utilities

## TypeScript Strict Mode

**Enabled:**
- `strict: true` in `tsconfig.json`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noFallthroughCasesInSwitch: true`
- `noUncheckedIndexedAccess: true`

**Implications:**
- All variables must be used or prefixed with `_` (e.g., `_unused`)
- All function parameters must be used or prefixed with `_`
- Type safety is strict; avoid `any` unless absolutely necessary
- Use `unknown` instead of `any` when type is genuinely unknown
- Index access on objects may be undefined; handle explicitly

---

*Convention analysis: 2026-03-13*
