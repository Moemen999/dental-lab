import { useDashboardStats } from '@/hooks/useSupabase';
import { useCases } from '@/hooks/useSupabase';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AutoDir, CaseNumber } from '@/components/ui/Bidi';
import { formatRelativeTime } from '@/lib/utils';
import { Link } from 'react-router-dom';
import {
  FileText,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Users,
  Package,
  ArrowRight,
  Truck,
  Wallet,
} from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { errorMessage } from '@/i18n/errors';
import { caseTypeLabel, type CaseStatus } from '@/types/database';
import { t } from '@/i18n';
import { usePageTitle } from '@/hooks/usePageTitle';
import { LateCasesCard } from '@/components/LateCasesCard';

export function OwnerDashboard() {
  usePageTitle(t('dashboards.owner.title'));
  const { data: stats, isLoading: statsLoading, isError: statsFailed, error: statsError } = useDashboardStats();
  const { data: recentCases, isLoading: casesLoading } = useCases({ page: 1, pageSize: 10 });

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  const statCards = [
    {
      title: t('dashboards.owner.stats.total'),
      value: stats?.total || 0,
      icon: <FileText className="h-5 w-5 text-blue-600" />,
      color: 'bg-blue-50',
    },
    {
      title: t('dashboards.owner.stats.inProgress'),
      value: stats?.in_progress || 0,
      icon: <Clock className="h-5 w-5 text-cyan-600" />,
      color: 'bg-cyan-50',
    },
    {
      title: t('dashboards.owner.stats.overdue'),
      value: stats?.overdue || 0,
      icon: <AlertTriangle className="h-5 w-5 text-red-600" />,
      color: 'bg-red-50',
    },
    {
      title: t('dashboards.owner.stats.delivered'),
      value: stats?.delivered || 0,
      icon: <CheckCircle2 className="h-5 w-5 text-green-600" />,
      color: 'bg-green-50',
    },
    {
      title: t('dashboards.owner.stats.activeStaff'),
      value: stats?.activeEmployees || 0,
      icon: <Users className="h-5 w-5 text-purple-600" />,
      color: 'bg-purple-50',
    },
    {
      title: t('dashboards.owner.stats.awaitingPickup'),
      value: (stats?.awaiting_representative_pickup || 0) + (stats?.with_representative || 0),
      icon: <Truck className="h-5 w-5 text-orange-600" />,
      color: 'bg-orange-50',
    },
  ];

  const workflowStatuses: { status: CaseStatus; count: number }[] = [
    { status: 'intake_pending', count: stats?.intake_pending || 0 },
    { status: 'awaiting_assignment', count: stats?.awaiting_assignment || 0 },
    { status: 'assigned', count: stats?.assigned || 0 },
    { status: 'in_progress', count: stats?.in_progress || 0 },
    { status: 'completed', count: stats?.completed || 0 },
    { status: 'awaiting_reception_receipt', count: stats?.awaiting_reception_receipt || 0 },
    { status: 'received_by_reception', count: stats?.received_by_reception || 0 },
    { status: 'awaiting_representative_pickup', count: stats?.awaiting_representative_pickup || 0 },
    { status: 'with_representative', count: stats?.with_representative || 0 },
    { status: 'on_hold', count: stats?.on_hold || 0 },
    { status: 'rework_required', count: stats?.rework_required || 0 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('dashboards.owner.title')}</h1>
        <p className="text-[var(--muted-foreground)]">{t('dashboards.owner.subtitle')}</p>
      </div>

      <LateCasesCard />

      {statsFailed && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">{t('money.dashboard.statsError')}</p>
          <p>{errorMessage(statsError)}</p>
        </div>
      )}

      {/* Money (get_owner_dashboard_stats): owed by all doctors, and delivered cases without a price */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          to="/accounts"
          className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] bg-white p-4 transition-colors hover:bg-brand-teal-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Wallet className="h-6 w-6 shrink-0 text-brand-teal" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold text-[var(--foreground)]">{t('money.dashboard.outstanding')}</p>
              <p className="text-lg font-bold">{formatMoney(stats?.totalOutstanding)}</p>
            </div>
          </div>
          <span className="text-sm font-medium text-brand-teal">{t('money.dashboard.outstandingOpen')}</span>
        </Link>
        {(stats?.unpricedDeliveredCount ?? 0) > 0 && (
          <Link
            to="/pricing"
            className="flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 p-4 transition-colors hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <div className="flex min-w-0 items-center gap-3">
              <AlertTriangle className="h-6 w-6 shrink-0 text-amber-700" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-semibold text-amber-900">{t('money.dashboard.unpricedTitle')}</p>
                <p className="text-sm text-amber-900">
                  {t('money.dashboard.unpricedBody', { count: stats?.unpricedDeliveredCount ?? 0 })}
                </p>
              </div>
            </div>
            <span className="text-sm font-medium text-amber-900">{t('money.dashboard.unpricedOpen')}</span>
          </Link>
        )}
        {(stats?.deliveredWithoutDentistCount ?? 0) > 0 && (
          <Link
            to="/cases?status=delivered"
            className="flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 p-4 transition-colors hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <div className="flex min-w-0 items-center gap-3">
              <AlertTriangle className="h-6 w-6 shrink-0 text-amber-700" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-semibold text-amber-900">{t('money.dashboard.noDentistTitle')}</p>
                <p className="text-sm text-amber-900">
                  {t('money.dashboard.noDentistBody', { count: stats?.deliveredWithoutDentistCount ?? 0 })}
                </p>
              </div>
            </div>
            <span className="text-sm font-medium text-amber-900">{t('money.dashboard.noDentistOpen')}</span>
          </Link>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${stat.color}`}>
                  {stat.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{stat.title}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Workflow Pipeline */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {t('dashboards.owner.pipeline')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {workflowStatuses.map(({ status, count }) => (
                <Link
                  key={status}
                  to={`/cases?status=${status}`}
                  className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <StatusBadge status={status} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{count}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-[var(--muted-foreground)] rtl:-scale-x-100" />
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Cases */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {t('dashboards.owner.recentCases')}
              </span>
              <Link to="/cases" className="text-sm text-brand-teal hover:underline font-normal">
                {t('common.actions.viewAll')}
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {casesLoading ? (
              <div className="flex justify-center py-4">
                <Spinner />
              </div>
            ) : (
              <div className="space-y-3">
                {recentCases?.data.map((c) => (
                  <Link
                    key={c.id}
                    to={`/cases/${c.id}`}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2 px-3 rounded-md hover:bg-slate-50 transition-colors"
                  >
                    {/* basis-44 is wider than the unbroken case number: on a narrow screen the badge wraps below instead of overlapping it. */}
                    <div className="min-w-0 flex-1 basis-44">
                      <p className="text-sm font-medium">
                        <CaseNumber value={c.case_number} />
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)] truncate">
                        <AutoDir>{c.patient_name}</AutoDir> · {caseTypeLabel(c.case_type)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <StatusBadge status={c.current_status} />
                      <span className="whitespace-nowrap text-xs text-[var(--muted-foreground)]">
                        {formatRelativeTime(c.created_at)}
                      </span>
                    </div>
                  </Link>
                ))}
                {(!recentCases?.data || recentCases.data.length === 0) && (
                  <p className="text-sm text-[var(--muted-foreground)] text-center py-4">
                    {t('dashboards.owner.noCases')}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
