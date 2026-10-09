/**
 * The Add app picker's body: workspace projects not yet in Server control,
 * one kit list per workspace under a heading in the workspace colour. A row
 * press adds that project; while one is being added every row is inert.
 */
import { TechIconStrip } from '@/features/plugins/dev-tools/sub_workspaces/centerShared';
import { KitHost, ListRow, Rows } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevProject } from '@/lib/bindings/DevProject';

import type { PickerGroup } from './addAppModel';

export default function AddAppProjectList({
  groups,
  adding,
  onPick,
  emptyTitle,
}: {
  groups: readonly PickerGroup[];
  /** Project id being added, or null. */
  adding: string | null;
  onPick: (project: DevProject) => void;
  emptyTitle: string;
}) {
  const { t } = useTranslation();
  const s = t.browser.servers;

  return (
    <KitHost testId="server-add-projects">
      <div className="flex flex-col gap-4">
        {groups.length === 0 && (
          <Rows count={0} empty={{ title: emptyTitle }}>
            {null}
          </Rows>
        )}
        {groups.map((group) => (
          <section key={group.workspace?.id ?? 'none'} aria-label={group.workspace?.name ?? s.add_no_workspace}>
            <h3 className="mb-1 flex items-center gap-2 typo-heading text-foreground">
              <span
                aria-hidden
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: group.workspace?.color ?? 'var(--muted-foreground)' }}
              />
              {group.workspace?.name ?? s.add_no_workspace}
            </h3>
            <Rows count={group.projects.length} empty={{ title: emptyTitle }}>
              {group.projects.map((project) => (
                <ListRow
                  key={project.id}
                  name={project.name}
                  meta={adding === project.id ? s.add_adding : <span className="font-mono">{project.root_path}</span>}
                  figures={<TechIconStrip techStack={project.tech_stack} max={4} />}
                  onPress={adding === null ? () => onPick(project) : undefined}
                  testId={`server-add-project-${project.id}`}
                />
              ))}
            </Rows>
          </section>
        ))}
      </div>
    </KitHost>
  );
}
