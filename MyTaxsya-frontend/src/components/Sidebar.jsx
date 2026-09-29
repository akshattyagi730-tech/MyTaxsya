import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FileText, Users, Package, Truck, Boxes,
  Wallet, Receipt, ShoppingBag, BookOpen, Landmark, BarChart3, TrendingUp,
  Bot, Bell, UserCog, Settings as SettingsIcon, PanelLeftClose, PanelLeftOpen,
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
      { label: 'AI Assistant', path: '/assistant', icon: Bot },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Notifications', path: '/notifications', icon: Bell },
      { label: 'Team', path: '/team', icon: UserCog },
      { label: 'Settings', path: '/settings', icon: SettingsIcon },
    ],
  },
];

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
        transition-transform duration-300 lg:translate-x-0
        ${open ? 'translate-x-0' : '-translate-x-full'}
        ${collapsed ? 'lg:w-[76px]' : 'lg:w-[260px]'}
        lg:transition-[width] lg:duration-200
      `}>
        <div className={`flex items-center h-16 border-b border-sidebar-border ${collapsed ? 'lg:justify-center lg:px-0 px-5 gap-3' : 'px-5 gap-3'}`}>
          <img src="/logo.png" alt="My Taxsya Logo" className="w-9 h-9 object-contain rounded-md bg-card p-0.5 flex-shrink-0" />
          <div className={collapsed ? 'lg:hidden' : ''}>
            <p className="font-heading font-bold text-[15px] leading-tight text-sidebar-foreground whitespace-nowrap">My Taxsya</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider whitespace-nowrap">GST & Accounting</p>
          </div>
        </div>

        <nav className="px-3 py-4 overflow-y-auto overflow-x-hidden h-[calc(100%-4rem-3.25rem)]">
          {navSections.map((section) => (
            <div key={section.label} className="mb-5">
              <p className={`px-3 mb-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap ${collapsed ? 'lg:hidden' : ''}`}>
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={onClose}
                      title={collapsed ? item.label : undefined}
                      className={`
                        flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all
                        ${collapsed ? 'lg:justify-center lg:px-0' : ''}
                        ${isActive
                          ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-sm'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent'}
                      `}
                    >
                      <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
                      <span className={collapsed ? 'lg:hidden' : ''}>{item.label}</span>
                    </Link>
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
            text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors
            ${collapsed ? 'justify-center' : ''}
          `}
        >
          {collapsed ? <PanelLeftOpen className="w-[18px] h-[18px] flex-shrink-0" /> : <PanelLeftClose className="w-[18px] h-[18px] flex-shrink-0" />}
          {!collapsed && <span className="text-sm">Collapse</span>}
        </button>
      </aside>
    </>
  );
}
