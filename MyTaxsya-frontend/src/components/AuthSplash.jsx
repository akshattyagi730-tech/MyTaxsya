import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

// One-time intro shown when an auth page (login, register, etc.) first mounts:
// the logo pops in alone, then the screen "tears" along a diagonal — two
// triangular halves slide apart to opposite corners — revealing the actual
// page underneath. Purely decorative; never blocks clicks.
export default function AuthSplash() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 2100);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const tearTransition = { delay: 1.05, duration: 0.85, ease: [0.76, 0, 0.24, 1] };

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none overflow-hidden">
      {/* Upper-right triangular half, tears off toward the top-right corner */}
      <motion.div
        className="absolute inset-0"
        style={{
          background: 'hsl(var(--background))',
          clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%)',
          filter: 'drop-shadow(-10px 10px 18px rgba(59,42,34,.28))',
        }}
        initial={{ x: '0%', y: '0%' }}
        animate={{ x: '130%', y: '-130%' }}
        transition={tearTransition}
      />
      {/* Lower-left triangular half, tears off toward the bottom-left corner */}
      <motion.div
        className="absolute inset-0"
        style={{
          background: 'hsl(var(--background))',
          clipPath: 'polygon(0% 0%, 100% 100%, 0% 100%)',
          filter: 'drop-shadow(10px -10px 18px rgba(59,42,34,.28))',
        }}
        initial={{ x: '0%', y: '0%' }}
        animate={{ x: '-130%', y: '130%' }}
        transition={tearTransition}
      />

      <motion.img
        src="/logo.png"
        alt="My Taxsya"
        className="absolute top-1/2 left-1/2 w-28 h-28 sm:w-36 sm:h-36 object-contain rounded-[28%] shadow-xl"
        initial={{ opacity: 0, scale: 0.7, x: '-50%', y: '-50%' }}
        animate={{ opacity: [0, 1, 1, 0], scale: [0.7, 1, 1, 0.85], x: '-50%', y: '-50%' }}
        transition={{ duration: 1.2, times: [0, 0.3, 0.78, 1], ease: 'easeInOut' }}
      />
    </div>
  );
}
