/**
 * The Identity section's body: who the twin is, in the shape the text wants.
 *
 * Name and role are short and sit side by side once there is room for two
 * columns; the biography is the longest thing in Setup and gets the full width
 * and enough rows to see a paragraph at once, with a running word count under
 * it. That is the whole reason this stopped being a drawer.
 */

import { useTranslation } from '@/i18n/useTranslation';
import type { SetupFieldEdit } from '../setupContract';
import { SetupTextField } from './SetupTextField';

interface IdentityFieldsProps {
  values: Partial<Record<string, string>>;
  commit: (change: Omit<SetupFieldEdit, 'value'>) => (value: string) => Promise<void>;
}

export function IdentityFields({ values, commit }: IdentityFieldsProps) {
  const { t } = useTranslation();
  const ts = t.twin.setup.fields;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <SetupTextField
          label={ts.name}
          slotKey="name"
          initial={values.name ?? ''}
          edit={commit({ field: 'name' })}
        />
        <SetupTextField
          label={ts.role}
          slotKey="role"
          initial={values.role ?? ''}
          edit={commit({ field: 'role' })}
        />
      </div>

      <SetupTextField
        label={ts.bio}
        slotKey="bio"
        initial={values.bio ?? ''}
        rows={10}
        showWords
        helpText={ts.bioHint}
        edit={commit({ field: 'bio' })}
      />

      <div className="md:max-w-xl">
        <SetupTextField
          label={ts.obsidianSubpath}
          slotKey="obsidianSubpath"
          initial={values.obsidianSubpath ?? ''}
          mono
          helpText={ts.obsidianSubpathHint}
          edit={commit({ field: 'obsidianSubpath' })}
        />
      </div>
    </div>
  );
}

export default IdentityFields;
