import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useCases, useUpdateCaseStatus } from '@/hooks/useSupabase';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { AutoDir, CaseNumber, Ltr } from '@/components/ui/Bidi';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
import { Textarea } from '@/components/ui/Textarea';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import {
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  CASE_STATUS_LABELS,
  caseTypeLabel,
  shadeLabel,
  type Case,
  type CaseStatus,
} from '@/types/database';
import { formatDate, isOverdue } from '@/lib/utils';
import {
  Play,
  CheckCircle,
  Clock,
  AlertTriangle,
  Send,
  PauseCircle,
  Eye,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { tx } from '@/i18n/rich';
import { errorMessage } from '@/i18n/errors';
import { usePageTitle } from '@/hooks/usePageTitle';

export function TechnicianDashboard() {
  usePageTitle(t('layout.nav.myCases'));
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'assigned' | 'in_progress' | 'all'>('in_progress');

  const { data: casesData, isLoading, refetch } = useCases({
    technician_id: profile?.id,
    pageSize: 50,
  });
  const updateStatus = useUpdateCaseStatus();

  // Dialog for status updates with notes (e.g. hold / complete)
  const [dialogCase, setDialogCase] = useState<Case | null>(null);
  const [targetStatus, setTargetStatus] = useState<CaseStatus | null>(null);
  const [dialogNote, setDialogNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const myCases = casesData?.data || [];

  const assignedCases = myCases.filter((c) => c.current_status === 'assigned');
  const inProgressCases = myCases.filter((c) => c.current_status === 'in_progress');
  const onHoldCases = myCases.filter((c) => c.current_status === 'on_hold');
  const reworkCases = myCases.filter((c) => c.current_status === 'rework_required');

  const displayedCases =
    activeTab === 'assigned'
      ? assignedCases
      : activeTab === 'in_progress'
      ? inProgressCases
      : myCases;

  const handleStartWork = async (c: Case) => {
    try {
      await updateStatus.mutateAsync({
        caseId: c.id,
        newStatus: 'in_progress',
        notes: t('dashboards.technician.notes.started'),
      });
      toast.success(t('dashboards.technician.toasts.started', { caseNumber: c.case_number }));
      refetch();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    }
  };

  const openStatusDialog = (c: Case, status: CaseStatus) => {
    setDialogCase(c);
    setTargetStatus(status);
    setDialogNote('');
  };

  const handleConfirmStatus = async () => {
    if (!dialogCase || !targetStatus) return;
    try {
      setSubmitting(true);
      await updateStatus.mutateAsync({
        caseId: dialogCase.id,
        newStatus: targetStatus,
        notes: dialogNote || undefined,
      });
      toast.success(t('dashboards.technician.toasts.updated', { status: CASE_STATUS_LABELS[targetStatus] }));
      setDialogCase(null);
      setTargetStatus(null);
      refetch();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const tabClass = (tab: typeof activeTab) =>
    `px-3 py-1 text-xs rounded font-medium transition ${
      activeTab === tab ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
    }`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {tx('dashboards.technician.welcome', { name: profile?.full_name })}
          </h1>
          <p className="text-sm text-slate-500">{t('dashboards.technician.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 me-1" />
          {t('common.actions.refresh')}
        </Button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="cursor-pointer hover:border-brand-teal transition" onClick={() => setActiveTab('in_progress')}>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500 font-medium">{t('dashboards.technician.metrics.inProgress')}</span>
              <div className="text-2xl font-bold text-cyan-600 mt-0.5">
                {inProgressCases.length}
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600">
              <Clock className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-brand-teal transition" onClick={() => setActiveTab('assigned')}>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500 font-medium">{t('dashboards.technician.metrics.readyToStart')}</span>
              <div className="text-2xl font-bold text-indigo-600 mt-0.5">
                {assignedCases.length}
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Play className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500 font-medium">{t('dashboards.technician.metrics.onHoldRework')}</span>
              <div className="text-2xl font-bold text-amber-600 mt-0.5">
                {onHoldCases.length + reworkCases.length}
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-brand-teal transition" onClick={() => setActiveTab('all')}>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500 font-medium">{t('dashboards.technician.metrics.total')}</span>
              <div className="text-2xl font-bold text-slate-800 mt-0.5">
                {myCases.length}
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <CheckCircle className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Workbench Cases List */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 gap-3">
          <CardTitle className="text-base">{t('dashboards.technician.queueTitle')}</CardTitle>
          <div className="flex rounded-md border border-slate-200 p-0.5 bg-slate-50 self-start">
            <button onClick={() => setActiveTab('in_progress')} className={tabClass('in_progress')}>
              {t('dashboards.technician.tabs.inProgress', { count: inProgressCases.length })}
            </button>
            <button onClick={() => setActiveTab('assigned')} className={tabClass('assigned')}>
              {t('dashboards.technician.tabs.assigned', { count: assignedCases.length })}
            </button>
            <button onClick={() => setActiveTab('all')} className={tabClass('all')}>
              {t('dashboards.technician.tabs.all', { count: myCases.length })}
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : displayedCases.length === 0 ? (
            <EmptyState
              title={t('dashboards.technician.empty.title')}
              description={t('dashboards.technician.empty.description')}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common.labels.caseNumber')}</TableHead>
                    <TableHead>{t('common.labels.patient')}</TableHead>
                    <TableHead>{t('dashboards.technician.columns.specifications')}</TableHead>
                    <TableHead>{t('common.labels.priority')}</TableHead>
                    <TableHead>{t('common.labels.status')}</TableHead>
                    <TableHead>{t('dashboards.technician.columns.targetDue')}</TableHead>
                    <TableHead className="text-end">{t('common.labels.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedCases.map((c) => {
                    const overdue = isOverdue(c.due_date, c.current_status);

                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-semibold whitespace-nowrap">
                          <Link
                            to={`/cases/${c.id}`}
                            className="text-sm text-brand-teal hover:underline"
                          >
                            <CaseNumber value={c.case_number} />
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-slate-900"><AutoDir>{c.patient_name}</AutoDir></div>
                          <div className="text-xs text-slate-500">
                            <AutoDir>{c.dentist?.name || c.dentist_name_text || t('common.labels.defaultDentist')}</AutoDir>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-semibold text-slate-800">
                            {caseTypeLabel(c.case_type)}
                          </div>
                          <div className="text-xs text-slate-500 flex flex-wrap gap-x-2">
                            {c.tooth_number && (
                              <span>{tx('common.labels.tooth', { value: <Ltr>{c.tooth_number}</Ltr> })}</span>
                            )}
                            {c.shade && (
                              <span>{tx('common.labels.shade', { value: <Ltr>{shadeLabel(c.shade)}</Ltr> })}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              PRIORITY_COLORS[c.priority]
                            }`}
                          >
                            {PRIORITY_LABELS[c.priority]}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={c.current_status} />
                        </TableCell>
                        <TableCell>
                          {c.due_date ? (
                            <div className={`text-xs whitespace-nowrap ${overdue ? 'text-red-600 font-bold' : 'text-slate-600'}`}>
                              {formatDate(c.due_date)}
                              {overdue && <span className="block text-[11px] text-red-700">{t('common.labels.overdue')}</span>}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="flex items-center justify-end gap-1.5">
                            {c.current_status === 'assigned' && (
                              <Button
                                size="sm"
                                onClick={() => handleStartWork(c)}
                              >
                                <Play className="h-3.5 w-3.5 me-1" />
                                {t('dashboards.technician.startWork')}
                              </Button>
                            )}

                            {c.current_status === 'in_progress' && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => openStatusDialog(c, 'completed')}
                                >
                                  <CheckCircle className="h-3.5 w-3.5 me-1" />
                                  {t('dashboards.technician.complete')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openStatusDialog(c, 'on_hold')}
                                  title={t('dashboards.technician.putOnHold')}
                                  aria-label={t('dashboards.technician.putOnHold')}
                                >
                                  <PauseCircle className="h-3.5 w-3.5 text-amber-600" />
                                </Button>
                              </>
                            )}

                            {c.current_status === 'completed' && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => openStatusDialog(c, 'awaiting_reception_receipt')}
                              >
                                <Send className="h-3.5 w-3.5 me-1 rtl:-scale-x-100" />
                                {t('dashboards.technician.submitToReception')}
                              </Button>
                            )}

                            <Link to={`/cases/${c.id}`}>
                              <Button
                                variant="ghost"
                                size="sm"
                                title={t('common.actions.viewDetails')}
                                aria-label={t('common.actions.viewDetails')}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status Dialog */}
      <Dialog
        open={!!dialogCase}
        onOpenChange={(open) => !open && setDialogCase(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboards.technician.dialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-600">
              {tx('dashboards.technician.dialog.body', {
                caseNumber: <strong className="text-slate-900"><CaseNumber value={dialogCase?.case_number} /></strong>,
                status: <strong className="text-brand-teal">{targetStatus ? CASE_STATUS_LABELS[targetStatus] : ''}</strong>,
              })}
            </p>

            <Textarea
              label={t('dashboards.technician.dialog.notesLabel')}
              rows={3}
              placeholder={t('dashboards.technician.dialog.notesPlaceholder')}
              value={dialogNote}
              onChange={(e) => setDialogNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogCase(null)}>
              {t('common.actions.cancel')}
            </Button>
            <Button onClick={handleConfirmStatus} disabled={submitting}>
              {submitting ? t('common.states.updating') : t('common.actions.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
