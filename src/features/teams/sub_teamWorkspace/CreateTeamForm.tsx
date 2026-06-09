import { Check, Code2, GitFork } from 'lucide-react';
import { FormField, type FieldAvailability } from '@/features/shared/components/forms/FormField';
import {
  useAsyncFieldValidation,
  suggestAlternativeName,
} from '@/features/shared/components/forms/useAsyncFieldValidation';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { GitHubRepoSelector, parseRepoUrl } from '@/features/plugins/dev-tools/sub_projects/GitHubRepoSelector';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';

const TEAM_COLORS: Record<string, string> = {
  '#6366f1': 'Indigo',
  '#8b5cf6': 'Violet',
  '#ec4899': 'Pink',
  '#f43f5e': 'Rose',
  '#f97316': 'Orange',
  '#eab308': 'Yellow',
  '#22c55e': 'Green',
  '#06b6d4': 'Cyan',
  '#3b82f6': 'Blue',
};

interface CreateTeamFormProps {
  newName: string;
  onNameChange: (name: string) => void;
  newDescription: string;
  onDescriptionChange: (desc: string) => void;
  newColor: string;
  onColorChange: (color: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Existing team names, used to flag duplicates inline as the user types. */
  existingNames?: string[];
  // -- Codebase repository (provisions a Codebase connector on create) --
  /** Vault GitHub PAT credentials, offered to authenticate the repo list. */
  githubCreds: { id: string; name: string }[];
  prCredentialId: string | null;
  onCredChange: (id: string | null) => void;
  githubUrl: string;
  onGithubUrlChange: (url: string) => void;
  mainBranch: string;
  onMainBranchChange: (branch: string) => void;
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
  existingNames = [],
  githubCreds,
  prCredentialId,
  onCredChange,
  githubUrl,
  onGithubUrlChange,
  mainBranch,
  onMainBranchChange,
}: CreateTeamFormProps) {
  const { t, tx } = useTranslation();
  const dp = t.plugins.dev_projects;
  const repoUrlValid = !githubUrl.trim() || parseRepoUrl(githubUrl) !== null;

  const nameCheck = useAsyncFieldValidation({
    check: (value) => {
      const lower = value.toLowerCase();
      const taken = existingNames.some((n) => n.trim().toLowerCase() === lower);
      return taken
        ? { available: false, suggestion: suggestAlternativeName(value, existingNames) }
        : { available: true };
    },
  });

  const availability: FieldAvailability = {
    status: nameCheck.status,
    message:
      nameCheck.status === 'checking'
        ? t.common.field_checking_availability
        : nameCheck.status === 'available'
          ? t.common.field_name_available
          : nameCheck.status === 'taken'
            ? nameCheck.suggestion
              ? tx(t.common.field_name_taken_suggestion, { name: nameCheck.suggestion })
              : t.common.field_name_taken
            : undefined,
  };

  return (
    <div
      className="animate-fade-slide-in mb-6 p-4 rounded-modal bg-secondary/40 backdrop-blur-sm border border-indigo-500/20"
    >
      <div className="space-y-4">
        <FormField label={t.pipeline.team_name} required availability={availability}>
          {(inputProps) => (
            <input
              {...inputProps}
              type="text"
              value={newName}
              onChange={(e) => {
                onNameChange(e.target.value);
                nameCheck.onChange(e.target.value);
              }}
              placeholder={t.pipeline.team_name_placeholder}
              className={INPUT_FIELD}
              autoFocus
            />
          )}
        </FormField>
        <FormField label={t.common.description}>
          {(inputProps) => (
            <input
              {...inputProps}
              type="text"
              value={newDescription}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder={t.pipeline.team_description_placeholder}
              className={INPUT_FIELD}
            />
          )}
        </FormField>
        <div>
          <label className="typo-body font-medium text-foreground mb-1.5 block">{t.pipeline.color}</label>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(TEAM_COLORS).map(([hex, name]) => {
              const isSelected = newColor === hex;
              return (
                <button
                  key={hex}
                  onClick={() => onColorChange(hex)}
                  className={`flex flex-col items-center gap-1 group`}
                >
                  <span
                    className={`w-9 h-9 rounded-card transition-all flex items-center justify-center ${isSelected ? 'ring-2 ring-offset-2 ring-offset-background scale-110' : 'hover:scale-105'}`}
                    style={{ backgroundColor: hex }}
                  >
                    {isSelected && (
                      <Check className="w-4 h-4 text-foreground drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
                    )}
                  </span>
                  <span className={`text-[10px] leading-tight ${isSelected ? 'text-foreground/90 font-medium' : 'text-foreground'}`}>
                    {name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {/* Codebase repository — wires the team to a GitHub repo via a
            Codebase connector created on submit (see TeamList.handleCreate). */}
        <div className="pt-1 border-t border-primary/10">
          <div className="flex items-center gap-2 pt-3 mb-2.5">
            <Code2 className="w-3.5 h-3.5 text-indigo-300/80 flex-shrink-0" />
            <span className="typo-card-label">{t.pipeline.team_codebase_heading}</span>
          </div>
          <p className="typo-caption text-foreground mb-3">{t.pipeline.team_codebase_hint}</p>

          <div className="space-y-3">
            <div>
              <label className="typo-caption font-medium text-foreground mb-1.5 block">{t.pipeline.team_connector_label}</label>
              <ThemedSelect value={prCredentialId ?? ''} onValueChange={(v) => onCredChange(v || null)}>
                <option value="">{dp.team_binding_none}</option>
                {githubCreds.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </ThemedSelect>
            </div>

            <GitHubRepoSelector value={githubUrl} onChange={onGithubUrlChange} credentialId={prCredentialId} />

            <div>
              <label className="typo-caption font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                <GitFork className="w-3 h-3 text-indigo-300/70" />
                {dp.main_branch_label}
                <span className="typo-caption text-foreground font-normal">({dp.team_binding_optional})</span>
              </label>
              <input
                type="text"
                value={mainBranch}
                onChange={(e) => onMainBranchChange(e.target.value)}
                placeholder={dp.main_branch_placeholder}
                className={INPUT_FIELD}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          {/* The repo selector flags a bad URL inline; this is the matching
              submit gate so an invalid URL can't be created anyway. */}
          {!repoUrlValid && (
            <span className="typo-caption text-status-error mr-auto">{dp.invalid_repo_url}</span>
          )}
          <button
            onClick={onCancel}
            className="px-3 py-1.5 typo-body text-foreground hover:text-foreground/95 transition-colors"
          >
            {t.common.cancel}
          </button>
          <button
            onClick={onSubmit}
            disabled={!newName.trim() || !repoUrlValid}
            className="px-4 py-1.5 typo-body font-medium rounded-modal bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {t.pipeline.create_team}
          </button>
        </div>
      </div>
    </div>
  );
}
