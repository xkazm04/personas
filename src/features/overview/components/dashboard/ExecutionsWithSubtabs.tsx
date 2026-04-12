import GlobalExecutionList from '@/features/overview/sub_activity/components/GlobalExecutionList';

export default function ExecutionsWithSubtabs() {
  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      <div className="animate-fade-slide-in flex-1 min-h-0 flex flex-col">
        <GlobalExecutionList />
      </div>
    </div>
  );
}
