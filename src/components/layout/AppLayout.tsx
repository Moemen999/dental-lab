import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { ROLE_LABELS } from '@/types/database';
import {
  LayoutDashboard,
  FileText,
  Package,
  Users,
  Shield,
  Stethoscope,
  Menu,
  X,
  LogOut,
  User,
  Truck,
  ListChecks,
  AlarmClock,
  Tags,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { AutoDir } from '@/components/ui/Bidi';
import { t } from '@/i18n';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

export function AppLayout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (!profile) return null;

  const getNavItems = (): NavItem[] => {
    switch (profile.role) {
      case 'owner':
        return [
          { label: t('layout.nav.dashboard'), path: '/', icon: <LayoutDashboard className="h-5 w-5" /> },
          { label: t('layout.nav.cases'), path: '/cases', icon: <FileText className="h-5 w-5" /> },
          { label: t('layout.nav.lateCases'), path: '/late-cases', icon: <AlarmClock className="h-5 w-5" /> },
          { label: t('layout.nav.batches'), path: '/batches', icon: <Package className="h-5 w-5" /> },
          { label: t('layout.nav.dentists'), path: '/dentists', icon: <Stethoscope className="h-5 w-5" /> },
          { label: t('layout.nav.employees'), path: '/employees', icon: <Users className="h-5 w-5" /> },
          { label: t('layout.nav.workTypes'), path: '/work-types', icon: <ListChecks className="h-5 w-5" /> },
          { label: t('layout.nav.pricing'), path: '/pricing', icon: <Tags className="h-5 w-5" /> },
          { label: t('layout.nav.accounts'), path: '/accounts', icon: <Wallet className="h-5 w-5" /> },
          { label: t('layout.nav.audit'), path: '/audit', icon: <Shield className="h-5 w-5" /> },
        ];
      case 'receptionist':
        return [
          { label: t('layout.nav.dashboard'), path: '/', icon: <LayoutDashboard className="h-5 w-5" /> },
          { label: t('layout.nav.cases'), path: '/cases', icon: <FileText className="h-5 w-5" /> },
          { label: t('layout.nav.lateCases'), path: '/late-cases', icon: <AlarmClock className="h-5 w-5" /> },
          { label: t('layout.nav.batches'), path: '/batches', icon: <Package className="h-5 w-5" /> },
          { label: t('layout.nav.dentists'), path: '/dentists', icon: <Stethoscope className="h-5 w-5" /> },
          { label: t('layout.nav.accounts'), path: '/accounts', icon: <Wallet className="h-5 w-5" /> },
        ];
      case 'technician':
        return [
          { label: t('layout.nav.myCases'), path: '/', icon: <FileText className="h-5 w-5" /> },
        ];
      case 'representative':
        return [
          { label: t('layout.nav.dashboard'), path: '/', icon: <LayoutDashboard className="h-5 w-5" /> },
          { label: t('layout.nav.batches'), path: '/batches', icon: <Package className="h-5 w-5" /> },
          { label: t('layout.nav.deliveries'), path: '/deliveries', icon: <Truck className="h-5 w-5" /> },
        ];
      default:
        return [];
    }
  };

  const navItems = getNavItems();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden print:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar: sits on the start edge (right in RTL) */}
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-50 flex w-[260px] flex-col border-e border-[var(--border)] bg-white transition-transform duration-200 lg:translate-x-0 print:hidden',
          // Off-canvas toward the start edge, which is the right side in this RTL-only app.
          sidebarOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Logo: always on its own dark teal panel (never on white). Gold text only here. */}
        <div className="relative bg-brand-teal px-4 pt-4 pb-3 text-center">
          <img
            src="/branding/logo-panel.jpg"
            alt={t('common.app.logoAlt')}
            width={560}
            height={393}
            className="mx-auto h-auto w-full max-w-[170px]"
          />
          <p className="mt-2 text-sm font-bold leading-snug text-brand-gold">{t('common.app.name')}</p>
          <div className="mx-auto mt-2 h-0.5 w-10 rounded-full bg-brand-red" aria-hidden="true" />
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute top-3 end-3 text-white lg:hidden"
            aria-label={t('common.a11y.closeSidebar')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4" aria-label={t('layout.mainNav')}>
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-teal-50 text-brand-teal'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User info */}
        <div className="border-t border-[var(--border)] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-teal-50 text-brand-teal font-semibold text-sm">
              <User className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                <AutoDir>{profile.full_name}</AutoDir>
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {ROLE_LABELS[profile.role]}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-3 justify-start text-slate-600"
            onClick={handleSignOut}
          >
            {/* The door icon points toward the exit: flipped in RTL. */}
            <LogOut className="h-4 w-4 me-2 rtl:-scale-x-100" />
            {t('layout.signOut')}
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:ps-[260px] print:ps-0">
        {/* Header */}
        <header className="print:hidden sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-[var(--border)] bg-white px-4 lg:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden"
            aria-label={t('common.a11y.openSidebar')}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <span className="hidden sm:inline">
              <AutoDir>{profile.full_name}</AutoDir>
            </span>
            <span className="inline-flex items-center rounded-full bg-brand-teal-50 px-2.5 py-0.5 text-xs font-medium text-brand-teal">
              {ROLE_LABELS[profile.role]}
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-6 print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
