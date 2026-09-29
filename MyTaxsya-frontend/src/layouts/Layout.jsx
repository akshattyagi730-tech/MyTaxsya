import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import AssistantFab from '@/components/AssistantFab';
import AssistantDrawer from '@/components/AssistantDrawer';

const COLLAPSE_KEY = 'myTaxsya-sidebar-collapsed';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop rail collapse (icons-only), separate from the mobile open/close overlay above.
  // Persisted so the choice survives a refresh, same pattern as the theme toggle.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === 'true'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, String(collapsed)); } catch { /* private mode etc. — not critical */ }
  }, [collapsed]);
  const [assistantOpen, setAssistantOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} collapsed={collapsed} onToggleCollapse={() => setCollapsed(v => !v)} />
      <div className={collapsed ? 'lg:pl-[76px]' : 'lg:pl-[260px]'}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
      <AssistantFab open={assistantOpen} onClick={() => setAssistantOpen(true)} />
      <AssistantDrawer open={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </div>
  );
}
