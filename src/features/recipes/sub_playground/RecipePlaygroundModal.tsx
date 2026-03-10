import { useState } from 'react';
import { X, BookOpen, Play, Clock, GitBranch } from 'lucide-react';
import { motion } from 'framer-motion';
import { BaseModal } from '@/lib/ui/BaseModal';
import { TabTransition } from '@/features/templates/sub_generated/shared/TabTransition';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import { RecipeOverviewTab } from './tabs/RecipeOverviewTab';
import { RecipeTestRunnerTab } from './tabs/RecipeTestRunnerTab';
import { RecipeHistoryTab } from './tabs/RecipeHistoryTab';
import { RecipeVersionsTab } from './tabs/RecipeVersionsTab';
import { useRecipeTestRunner } from './useRecipeTestRunner';

type PlaygroundTab = 'overview' | 'test-runner' | 'history' | 'versions';

interface RecipePlaygroundModalProps {
  recipe: RecipeDefinition;
  onClose: () => void;
}

const TABS: Array<{ id: PlaygroundTab; label: string; icon: typeof BookOpen }> = [
  { id: 'overview', label: 'Overview', icon: BookOpen },
  { id: 'test-runner', label: 'Test Runner', icon: Play },
  { id: 'history', label: 'History', icon: Clock },
  { id: 'versions', label: 'Versions', icon: GitBranch },
];

export function RecipePlaygroundModal({ recipe, onClose }: RecipePlaygroundModalProps) {
  const [activeTab, setActiveTab] = useState<PlaygroundTab>('test-runner');
  const [currentRecipe, setCurrentRecipe] = useState(recipe);
  const testRunner = useRecipeTestRunner(currentRecipe);

  return (
    <BaseModal
      isOpen={true}
      onClose={onClose}
      titleId="recipe-playground-title"
      maxWidthClass="max-w-5xl"
      panelClassName="flex flex-col w-[90vw] max-w-5xl h-[85vh] rounded-xl border border-border/60 bg-background shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-0">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
          <BookOpen className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="recipe-playground-title" className="text-sm font-semibold text-foreground truncate">{currentRecipe.name}</h2>
          {currentRecipe.description && (
            <p className="text-sm text-muted-foreground truncate">{currentRecipe.description}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tab Bar */}
      <div className="relative flex gap-1 px-4 mt-3 border-b border-border/40">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/80'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.id === 'history' && testRunner.history.length > 0 && (
                <span className="ml-1 rounded-full bg-primary/20 px-1.5 py-0.5 text-sm text-primary">
                  {testRunner.history.length}
                </span>
              )}
              {isActive && (
                <motion.div
                  layoutId="recipePlaygroundTab"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t-full"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <TabTransition tabKey={activeTab}>
          {activeTab === 'overview' && <RecipeOverviewTab recipe={currentRecipe} />}
          {activeTab === 'test-runner' && <RecipeTestRunnerTab recipe={currentRecipe} />}
          {activeTab === 'versions' && (
            <RecipeVersionsTab recipe={currentRecipe} onRecipeUpdated={setCurrentRecipe} />
          )}
          {activeTab === 'history' && (
            <RecipeHistoryTab
              history={testRunner.history}
              onClear={testRunner.clearHistory}
            />
          )}
        </TabTransition>
      </div>
    </BaseModal>
  );
}
