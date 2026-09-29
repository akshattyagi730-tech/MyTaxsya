import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, FileText, Users, Package, Truck, Boxes,
  Wallet, Receipt, ShoppingBag, BookOpen, Landmark, BarChart3, TrendingUp,
  UserCog, Settings as SettingsIcon, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';

const navSections = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Sales & CRM',
    items: [
      { label: 'Invoices', path: '/invoices', icon: FileText },
      { label: 'Customers', path: '/customers', icon: Users },
      { label: 'Suppliers', path: '/suppliers', icon: Truck },
      { label: 'Products', path: '/products', icon: Package },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Inventory', path: '/inventory', icon: Boxes },
      { label: 'Payments', path: '/payments', icon: Wallet },
      { label: 'Expenses', path: '/expenses', icon: Receipt },
      { label: 'Purchase Bills', path: '/purchase-bills', icon: ShoppingBag },
      { label: 'Ledger', path: '/ledger', icon: BookOpen },
      { label: 'GST Center', path: '/gst', icon: Landmark },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Reports', path: '/reports', icon: BarChart3 },
      { label: 'Analytics', path: '/analytics', icon: TrendingUp },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Team', path: '/team', icon: UserCog },
      { label: 'Settings', path: '/settings', icon: SettingsIcon },
    ],
  },
];

// Flat running index across every section, so the whole sidebar cascades
// in on mount as one continuous stagger instead of resetting per section.
let __itemCounter = 0;
navSections.forEach((section) => {
  section.items.forEach((item) => {
    item.__i = __itemCounter++;
  });
});

const MotionLink = motion(Link);

// `collapsed` only ever applies at the lg breakpoint and up — on mobile the sidebar
// is always full width and shown/hidden via the slide-in overlay (`open`/`onClose`),
// a separate mechanism from the desktop icons-only rail toggled here.
export default function Sidebar({ open, onClose, collapsed, onToggleCollapse }) {
  const location = useLocation();

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={onClose} />}

      <aside className={`
        fixed top-0 left-0 z-50 h-full w-[260px] bg-sidebar border-r border-sidebar-border
        transition-transform duration-300 lg:translate-x-0 flex flex-col
        ${open ? 'translate-x-0' : '-translate-x-full'}
        ${collapsed ? 'lg:w-[76px]' : 'lg:w-[260px]'}
        lg:transition-[width] lg:duration-200
      `}>
        <div className={`flex items-center h-16 border-b border-sidebar-border flex-shrink-0 ${collapsed ? 'lg:justify-center lg:px-0 px-5 gap-3' : 'px-5 gap-3'}`}>
          <img src="/logo.png" alt="My Taxsya Logo" className="w-9 h-9 object-contain rounded-xl bg-card p-0.5 flex-shrink-0" />
          <div className={collapsed ? 'lg:hidden' : ''}>
            <p className="font-heading font-bold text-[15px] leading-tight text-sidebar-foreground whitespace-nowrap">My Taxsya</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider whitespace-nowrap">GST & Accounting</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto overflow-x-hidden">
          {navSections.map((section) => (
            <div key={section.label} className="mb-5">
              <p className={`px-3 mb-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap ${collapsed ? 'lg:hidden' : ''}`}>
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <MotionLink
                      key={item.path}
                      to={item.path}
                      onClick={onClose}
                      title={collapsed ? item.label : undefined}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: item.__i * 0.04, type: 'spring', stiffness: 260, damping: 20 }}
                      whileHover={{ x: 5 }}
                      whileTap={{ scale: 0.96 }}
                      className={`
                        relative flex items-center gap-3 px-3 py-2 rounded-full text-sm overflow-hidden
                        ${collapsed ? 'lg:justify-center lg:px-0' : ''}
                        ${isActive
                          ? 'text-sidebar-primary-foreground font-medium'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent transition-colors'}
                      `}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="sidebar-active-pill"
                          className="absolute inset-0 rounded-full bg-sidebar-primary shadow-sm"
                          transition={{ type: 'spring', stiffness: 220, damping: 18 }}
                        />
                      )}
                      <motion.span
                        className="relative z-10 flex items-center justify-center flex-shrink-0"
                        whileHover={{ rotate: [0, -16, 13, -9, 5, 0], scale: 1.2 }}
                        transition={{ duration: 0.6, ease: 'easeInOut' }}
                      >
                        <item.icon className="w-[18px] h-[18px]" />
                      </motion.span>
                      <span className={`relative z-10 ${collapsed ? 'lg:hidden' : ''}`}>{item.label}</span>
                    </MotionLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Desktop-only rail collapse toggle — mobile show/hide already works via the overlay above. */}
        <button
          type="button"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`
            hidden lg:flex items-center gap-2 h-[52px] w-full px-3 border-t border-sidebar-border
            text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors flex-shrink-0
            ${collapsed ? 'justify-center' : ''}
          `}
        >
          {collapsed ? <PanelLeftOpen className="w-[18px] h-[18px] flex-shrink-0" /> : <PanelLeftClose className="w-[18px] h-[18px] flex-shrink-0" />}
          {!collapsed && <span className="text-sm">Collapse</span>}
        </button>

        <div className={`px-4 py-3 border-t border-sidebar-border flex-shrink-0 text-center ${collapsed ? 'lg:hidden' : ''}`}>
          <p className="text-[10px] text-muted-foreground">
            Powered by <span className="font-medium">Stackvane Infotech Pvt Ltd</span>
          </p>
        </div>
      </aside>
    </>
  );
}
