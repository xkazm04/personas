import { Cloud } from 'lucide-react';
import EmptyState from '@/features/shared/components/feedback/EmptyState';

export default function CloudSyncPanel() {
  return (
    <div className="flex-1 flex items-center justify-center py-20">
      <EmptyState
        icon={Cloud}
        title="Cloud Sync"
        subtitle="Google Drive cloud sync coming soon. Connect your Google account to back up vaults across devices."
        iconColor="text-blue-400/80"
        iconContainerClassName="bg-blue-500/10 border-blue-500/20"
      />
    </div>
  );
}
