import { FormField } from '@/features/shared/components/forms/FormField';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

const TEAM_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6'];

interface CreateTeamFormProps {
  newName: string;
  onNameChange: (name: string) => void;
  newDescription: string;
  onDescriptionChange: (desc: string) => void;
  newColor: string;
  onColorChange: (color: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function CreateTeamForm({
  newName,
  onNameChange,
  newDescription,
  onDescriptionChange,
  newColor,
  onColorChange,
  onSubmit,
  onCancel,
}: CreateTeamFormProps) {
  return (
    <div
      className="animate-fade-slide-in mb-6 p-4 rounded-xl bg-secondary/40 backdrop-blur-sm border border-indigo-500/20"
    >
      <div className="space-y-4">
        <FormField label="Team Name" required>
          {(inputProps) => (
            <input
              {...inputProps}
              type="text"
              value={newName}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="e.g. Code Review Pipeline"
              className={INPUT_FIELD}
              autoFocus
            />
          )}
        </FormField>
        <FormField label="Description">
          {(inputProps) => (
            <input
              {...inputProps}
              type="text"
              value={newDescription}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="Optional description"
              className={INPUT_FIELD}
            />
          )}
        </FormField>
        <div>
          <label className="text-sm font-medium text-foreground/80 mb-1.5 block">Color</label>
          <div className="flex gap-2">
            {TEAM_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => onColorChange(c)}
                className={`w-7 h-7 rounded-lg transition-all ${newColor === c ? 'ring-2 ring-offset-2 ring-offset-background scale-110' : 'hover:scale-105'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-muted-foreground/80 hover:text-foreground/95 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={!newName.trim()}
            className="px-4 py-1.5 text-sm font-medium rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Create Team
          </button>
        </div>
      </div>
    </div>
  );
}
