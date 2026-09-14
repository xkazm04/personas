import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TriggerListItem } from './TriggerListItem';
import type { CloudTrigger } from '@/api/system/cloud';

const trigger = {
  id: 'tr-1', personaId: 'p1', triggerType: 'schedule', config: '{"cron":"0 * * * *"}', enabled: true,
  healthStatus: null, healthMessage: null, lastTriggeredAt: null, nextTriggerAt: null,
} as unknown as CloudTrigger;

describe('TriggerListItem write controls disarm while the request is in flight', () => {
  it('a second click on Delete before the first settles does not fire a second delete', async () => {
    let settle!: () => void;
    const onDelete = vi.fn(() => new Promise<void>((resolve) => { settle = resolve; }));
    render(
      <TriggerListItem
        trigger={trigger} isExpanded firings={[]} isLoadingFirings={false} personaName="p"
        onToggleExpand={() => {}} onToggleEnabled={() => {}} onDelete={onDelete}
      />,
    );
    const del = screen.getByTestId('cloud-trigger-delete-tr-1');
    fireEvent.click(del);
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledTimes(1);
    await act(async () => { settle(); });
    // Settled: the control re-arms (a failed request can be retried).
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledTimes(2);
  });
});
