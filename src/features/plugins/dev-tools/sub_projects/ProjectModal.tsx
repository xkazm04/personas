/**
 * ProjectModal — create and edit project dialog.
 * Extracted from ProjectManagerPage to isolate the multi-step modal flow.
 */
import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Button } from '@/features/shared/components/buttons';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import {
  FolderOpen, X, Plus, Pencil, Search, CheckCircle2,
} from 'lucide-react';
import {
  type ProjectType, type EditProjectData, PROJECT_TYPES,
} from './projectManagerTypes';
import { GitHubRepoSelector } from './GitHubRepoSelector';

type ModalStep = 'form' | 'created';

interface ProjectModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; path: string; projectType: ProjectType; githubUrl: string }) => Promise<{ id: string } | undefined>;
  onUpdate: (id: string, data: { name: string; projectType: ProjectType; githubUrl: string }) => Promise<void>;
  onScanNow: (projectId: string, rootPath: string, projectName: string) => void;
  editProject?: EditProjectData | null;
}

export function ProjectModal({
  open: isOpen,
  onClose,
  onCreate,
  onUpdate,
  onScanNow,
  editProject,
}: ProjectModalProps) {
  const isEdit = !!editProject;

  const [step, setStep] = useState<ModalStep>('form');
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('other');
  const [githubUrl, setGithubUrl] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [createdProject, setCreatedProject] = useState<{ id: string; name: string; path: string } | null>(null);
  const { shouldAnimate: _shouldAnimate } = useMotion();

  // Pre-fill form when editing
  useEffect(() => {
    if (editProject) {
      setName(editProject.name);
      setPath(editProject.path);
      setProjectType(editProject.projectType);
      setGithubUrl(editProject.githubUrl);
      setNameEdited(true);
    }
  }, [editProject]);

  const handleSelectFolder = async () => {
    if (isEdit) return; // path is read-only in edit mode
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select project folder',
      });
      if (!selected) return;
      const folderPath = typeof selected === 'string' ? selected : selected;
      setPath(folderPath);
      if (!nameEdited) {
        const segments = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/);
        const folderName = segments[segments.length - 1] || '';
        setName(folderName);
      }
    } catch {
      // User cancelled or error -- silently ignore
    }
  };

  const handleNameChange = (val: string) => {
    setName(val);
    setNameEdited(true);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !path.trim()) return;

    if (isEdit && editProject) {
      await onUpdate(editProject.id, {
        name: name.trim(),
        projectType,
        githubUrl: githubUrl.trim(),
      });
      handleClose();
    } else {
      const result = await onCreate({
        name: name.trim(),
        path: path.trim(),
        projectType,
        githubUrl: githubUrl.trim(),
      });
      if (result) {
        setCreatedProject({ id: result.id, name: name.trim(), path: path.trim() });
        setStep('created');
      }
    }
  };

  const handleClose = () => {
    setStep('form');
    setName('');
    setPath('');
    setProjectType('other');
    setGithubUrl('');
    setNameEdited(false);
    setCreatedProject(null);
    onClose();
  };

  const handleScanNow = () => {
    if (createdProject) {
      onScanNow(createdProject.id, createdProject.path, createdProject.name);
    }
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div
        className="animate-fade-slide-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      >
        <div
          className="animate-fade-slide-in bg-background border border-primary/10 rounded-2xl p-6 w-full max-w-md shadow-elevation-4"
          onClick={(e) => e.stopPropagation()}
        >
          {step === 'form' ? (
            <>
              <div className="flex items-center justify-between mb-5">
                <h2 className="typo-section-title">
                  {isEdit ? 'Edit Project' : 'New Project'}
                </h2>
                <Button variant="ghost" size="icon-sm" onClick={handleClose}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-4">
                {/* Folder picker (read-only in edit mode) */}
                <div>
                  <label className="typo-caption font-medium text-foreground mb-1.5 block">Project Folder</label>
                  <div className="flex gap-2">
                    <div
                      onClick={isEdit ? undefined : handleSelectFolder}
                      className={`flex-1 flex items-center gap-2 px-3 py-2 text-md bg-secondary/40 border border-primary/10 rounded-modal min-w-0 ${
                        isEdit ? 'opacity-60' : 'cursor-pointer hover:bg-secondary/60 transition-colors'
                      }`}
                    >
                      <FolderOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      {path ? (
                        <span className="text-foreground truncate">{path}</span>
                      ) : (
                        <span className="text-foreground">Select a folder...</span>
                      )}
                    </div>
                    {!isEdit && (
                      <Button variant="secondary" size="sm" onClick={handleSelectFolder}>
                        Browse
                      </Button>
                    )}
                  </div>
                </div>

                {/* Project Name */}
                <div>
                  <label className="typo-caption font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                    Project Name
                    {!isEdit && path && !nameEdited && (
                      <span className="text-[10px] text-foreground font-normal">(auto-filled from folder)</span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      value={name}
                      onChange={(e) => handleNameChange(e.target.value)}
                      placeholder="My Awesome App"
                      className="w-full px-3 py-2 pr-8 text-md bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-ring"
                    />
                    <Pencil className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
                  </div>
                </div>

                {/* Project Type */}
                <div>
                  <label className="typo-caption font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                    Project Type
                    <span className="text-[10px] text-foreground font-normal">(optional, visual only)</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {PROJECT_TYPES.map((pt) => (
                      <button
                        key={pt.id}
                        onClick={() => setProjectType(pt.id)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 typo-caption font-medium rounded-card border transition-all ${
                          projectType === pt.id
                            ? `${pt.color} ring-1 ring-current/20 scale-105`
                            : 'bg-secondary/30 border-primary/10 text-foreground hover:bg-secondary/50'
                        }`}
                      >
                        <span>{pt.icon}</span>
                        {pt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* GitHub URL -- repo selector (if PAT available) or manual input */}
                <GitHubRepoSelector value={githubUrl} onChange={setGithubUrl} />
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <Button variant="ghost" size="sm" onClick={handleClose}>Cancel</Button>
                <Button
                  variant="accent"
                  accentColor="amber"
                  size="sm"
                  icon={isEdit ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  disabled={!name.trim() || !path.trim()}
                  onClick={handleSubmit}
                >
                  {isEdit ? 'Save Changes' : 'Create Project'}
                </Button>
              </div>
            </>
          ) : (
            /* Post-creation step: offer context scan */
            <>
              <div className="text-center py-2">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                </div>
                <h2 className="typo-section-title mb-1">
                  Project Created
                </h2>
                <p className="typo-caption text-foreground mb-6">
                  <span className="font-medium text-foreground">{createdProject?.name}</span> is ready.
                  Would you like to generate a context map now?
                </p>

                <div className="bg-primary/5 border border-primary/10 rounded-modal p-4 mb-6 text-left">
                  <div className="flex items-start gap-3">
                    <Search className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="typo-card-label mb-1">Generate Context Map</h4>
                      <p className="typo-caption text-foreground">
                        Scans your codebase to identify business features and organize them into context groups.
                        This runs in the background -- you&apos;ll get a notification when it&apos;s done.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-center gap-2">
                  <Button variant="ghost" size="sm" onClick={handleClose}>
                    Skip for now
                  </Button>
                  <Button
                    variant="accent"
                    accentColor="amber"
                    size="sm"
                    icon={<Search className="w-3.5 h-3.5" />}
                    onClick={handleScanNow}
                  >
                    Scan Codebase
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
  );
}
