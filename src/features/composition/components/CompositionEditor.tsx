/**
 * CompositionEditor — top-level page for the Workflows sidebar section.
 *
 * Shows WorkflowList when no workflow is selected, or WorkflowCanvas
 * when editing a specific workflow.
 */
import { usePipelineStore } from '@/stores/pipelineStore';
import { ContentBox } from '@/features/shared/components/layout/ContentLayout';
import WorkflowList from './WorkflowList';
import WorkflowCanvas from './WorkflowCanvas';

export default function CompositionEditor() {
  const selectedWorkflowId = usePipelineStore((s) => s.selectedWorkflowId);

  return (
    <ContentBox minWidth={0} data-testid="composition-editor">
      {selectedWorkflowId ? <WorkflowCanvas /> : <WorkflowList />}
    </ContentBox>
  );
}
