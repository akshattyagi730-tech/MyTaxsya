import { motion } from 'framer-motion';
import { Bot } from 'lucide-react';

// Floating button, bottom-right of every authenticated page, that opens the
// AI Assistant as a right-side drawer (see AssistantDrawer). Hidden while
// that drawer is already open.
export default function AssistantFab({ open, onClick }) {
  if (open) return null;

  return (
    <motion.button
      onClick={onClick}
      title="AI Assistant"
      aria-label="Open AI Assistant"
      initial={{ opacity: 0, scale: 0.6, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.6, y: 20 }}
      transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.3 }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.94 }}
      className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
    >
      <span aria-hidden className="absolute inset-0 rounded-full bg-primary/40 animate-ping" />
      <Bot className="w-6 h-6 relative z-10" />
    </motion.button>
  );
}
