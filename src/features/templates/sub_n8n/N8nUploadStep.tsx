import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Upload, FileJson } from 'lucide-react';

interface N8nUploadStepProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFileDrop?: (file: File) => void;
}

export function N8nUploadStep({ fileInputRef, onFileSelect, onFileDrop }: N8nUploadStepProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file && onFileDrop) {
        onFileDrop(file);
      }
    },
    [onFileDrop],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      onClick={() => fileInputRef.current?.click()}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex flex-col items-center justify-center gap-4 p-12 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 ${
        isDragging
          ? 'border-violet-400/60 bg-violet-500/10 scale-[1.01]'
          : 'border-primary/15 bg-secondary/20 hover:border-primary/30 hover:bg-secondary/30'
      }`}
    >
      <motion.div
        animate={isDragging ? { scale: 1.1, y: -4 } : { scale: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className={`w-16 h-16 rounded-2xl border flex items-center justify-center transition-colors duration-200 ${
          isDragging
            ? 'bg-violet-500/25 border-violet-400/40'
            : 'bg-violet-500/15 border-violet-500/25'
        }`}
      >
        <Upload className={`w-8 h-8 transition-colors duration-200 ${isDragging ? 'text-violet-300' : 'text-violet-400'}`} />
      </motion.div>
      <div className="text-center">
        <p className="text-sm font-medium text-foreground/80">
          {isDragging ? 'Drop your workflow file here' : 'Select your n8n workflow JSON'}
        </p>
        <p className="text-sm text-muted-foreground/90 mt-1">
          Click to browse or drag and drop your exported workflow
        </p>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground/80">
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
