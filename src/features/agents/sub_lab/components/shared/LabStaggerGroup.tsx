import { motion, type Variants } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import type { ReactNode, CSSProperties } from 'react';

const containerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: 0.05,
      staggerChildren: 0.04,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
  },
};

interface StaggerGroupProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function LabStaggerGroup({ children, className, style }: StaggerGroupProps) {
  const { shouldAnimate } = useMotion();

  if (!shouldAnimate) {
    return <div className={className} style={style}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      style={style}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  );
}

interface StaggerItemProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}

export function LabStaggerItem({ children, className, style, 'data-testid': testId }: StaggerItemProps) {
  const { shouldAnimate } = useMotion();

  if (!shouldAnimate) {
    return <div className={className} style={style} data-testid={testId}>{children}</div>;
  }

  return (
    <motion.div className={className} style={style} data-testid={testId} variants={itemVariants}>
      {children}
    </motion.div>
  );
}
