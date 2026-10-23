/**
 * Money routes and navigation per role: الأسعار is owner-only; الحسابات and the
 * statement are owner + receptionist. Technicians and representatives get neither
 * the links nor the pages (the database refuses them too).
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { ar } from '@/i18n/ar';
import type { AppRole } from '@/types/database';

const { auth } = vi.hoisted(() => ({ auth: { role: 'owner' as AppRole } }));

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => ({
    user: { id: 'u1' },
    loading: false,
    signOut: vi.fn(),
    profile: { id: 'u1', full_name: 'مستخدم', role: auth.role, status: 'active' },
  }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/pages/PricingPage', () => ({ PricingPage: () => <p>PRICING-PAGE</p> }));
vi.mock('@/pages/AccountsPage', () => ({ AccountsPage: () => <p>ACCOUNTS-PAGE</p> }));
vi.mock('@/pages/StatementPage', () => ({ StatementPage: () => <p>STATEMENT-PAGE</p> }));
vi.mock('@/pages/DashboardRouter', () => ({ DashboardRouter: () => <p>HOME</p> }));

import { App } from '@/App';

afterEach(cleanup);

function renderAt(role: AppRole, path: string) {
  auth.role = role;
  window.history.pushState({}, '', path);
  return render(<App />);
}

const NAV = ar.layout.nav;

describe('money routes', () => {
  it.each([
    ['owner', '/pricing', 'PRICING-PAGE'],
    ['owner', '/accounts', 'ACCOUNTS-PAGE'],
    ['owner', '/accounts/d1', 'STATEMENT-PAGE'],
    ['receptionist', '/accounts', 'ACCOUNTS-PAGE'],
    ['receptionist', '/accounts/d1', 'STATEMENT-PAGE'],
  ] as const)('%s can open %s', (role, path, marker) => {
    renderAt(role, path);
    expect(screen.getByText(marker)).toBeInTheDocument();
  });

  it.each([
    ['receptionist', '/pricing'],
    ['technician', '/pricing'],
    ['technician', '/accounts'],
    ['technician', '/accounts/d1'],
    ['representative', '/pricing'],
    ['representative', '/accounts'],
    ['representative', '/accounts/d1'],
  ] as const)('%s is refused %s', (role, path) => {
    renderAt(role, path);
    expect(screen.getByText(ar.auth.accessDenied.title)).toBeInTheDocument();
    expect(screen.queryByText(/PAGE$/)).not.toBeInTheDocument();
  });
});

describe('money navigation links', () => {
  it.each([
    ['owner', true, true],
    ['receptionist', false, true],
    ['technician', false, false],
    ['representative', false, false],
  ] as const)('%s: pricing link %s, accounts link %s', (role, pricing, accounts) => {
    renderAt(role, '/');
    const nav = screen.getByRole('navigation', { name: ar.layout.mainNav });
    const pricingLink = within(nav).queryByRole('link', { name: NAV.pricing });
    const accountsLink = within(nav).queryByRole('link', { name: NAV.accounts });
    expect(!!pricingLink).toBe(pricing);
    expect(!!accountsLink).toBe(accounts);
    if (pricingLink) expect(pricingLink).toHaveAttribute('href', '/pricing');
    if (accountsLink) expect(accountsLink).toHaveAttribute('href', '/accounts');
  });
});
