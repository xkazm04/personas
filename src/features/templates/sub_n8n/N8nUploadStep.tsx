import { motion } from 'framer-motion';
import { Upload, FileJson } from 'lucide-react';

interface N8nUploadStepProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function N8nUploadStep({ fileInputRef, onFileSelect }: N8nUploadStepProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      onClick={() => fileInputRef.current?.click()}
      className="relative flex flex-col items-center justify-center gap-4 p-12 rounded-xl border-2 border-dashed cursor-pointer transition-colors border-primary/15 bg-secondary/20 hover:border-primary/30 hover:bg-secondary/30"
    >
      <motion.div
        animate={{ scale: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-16 h-16 rounded-2xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center"
      >
        <Upload className="w-8 h-8 text-violet-400" />
      </motion.div>
      <div className="text-center">
        <p className="text-sm font-medium text-foreground/80">Select your n8n workflow JSON</p>
        <p className="text-xs text-muted-foreground/50 mt-1">
          Desktop drag-and-drop is disabled in this importer; click to browse files
        </p>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground/40">
        <FileJson className="w-4 h-4" />
        <span>Accepts .json files exported from n8n</span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={onFileSelect}
        className="hidden"
      />
    </motion.div>
  );
}
