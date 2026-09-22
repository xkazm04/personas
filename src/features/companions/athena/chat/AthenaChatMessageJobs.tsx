/**
 * AthenaChatMessageJobs — connector/background job cards pinned under a turn.
 *
 * Its own component so the `jobsById` subscription lives ONLY on the handful of
 * rows that actually spawned a job. Subscribing in the transcript would make
 * every job transition (they tick progress) re-render the whole message list.
 */

import { memo } from 'react';
import { useCompanionStore } from '../companionStore';
import { ConnectorCallCard } from '../ConnectorCallCard';
import { TaskTag } from '../TaskTag';

export const AthenaChatMessageJobs = memo(function AthenaChatMessageJobs({
  jobIds,
}: {
  jobIds: string[];
}) {
  const jobsById = useCompanionStore((s) => s.jobsById);
  if (jobIds.length === 0) return null;
  return (
    <>
      {jobIds.map((jobId) => {
        const job = jobsById[jobId];
        if (!job) return null;
        return job.kind === 'connector_use' ? (
          <ConnectorCallCard key={jobId} job={job} />
        ) : (
          <TaskTag key={jobId} job={job} />
        );
      })}
    </>
  );
});
