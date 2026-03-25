interface TabTransitionProps {
  tabKey: string;
  children: React.ReactNode;
}

export function TabTransition({ tabKey, children }: TabTransitionProps) {
  return (
    <div className="animate-fade-slide-in"
        key={tabKey}
      >
        {children}
      </div>
  );
}
