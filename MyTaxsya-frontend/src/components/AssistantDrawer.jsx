import { AnimatePresence, motion } from 'framer-motion';
import { X, Bot } from 'lucide-react';
import AssistantPanel from '@/components/AssistantPanel';

// Right-side sliding panel for the AI Assistant — same slide-in mechanism as
// the mobile Sidebar drawer, just anchored to the opposite edge.
export default function AssistantDrawer({ open, onClose }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/40 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed top-0 right-0 z-50 h-full w-full sm:w-[420px] bg-background border-l border-border shadow-2xl flex flex-col"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
          >
            <div className="flex items-center justify-between gap-3 px-5 h-16 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-secondary text-white flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-heading font-semibold text-sm leading-tight truncate">AI Assistant</p>
                  <p className="text-xs text-muted-foreground truncate">Ask about your business</p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close AI Assistant"
                className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 flex flex-col min-h-0 p-3">
              <AssistantPanel bordered={false} />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
