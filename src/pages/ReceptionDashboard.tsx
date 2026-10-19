import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  useCases,
  useUpdateCaseStatus,
  useAssignTechnician,
  useTechnicians,
} from '@/hooks/useSupabase';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { AutoDir, CaseNumber } from '@/components/ui/Bidi';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { caseTypeLabel, type Case } from '@/types/database';
import { formatDate } from '@/lib/utils';
import {
  Plus,
  Inbox,
  CheckCircle,
  Truck,
  UserCheck,
  RefreshCw,
  Send,
  Package,
} from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { tx } from '@/i18n/rich';
import { errorMessage } from '@/i18n/errors';
import { usePageTitle } from '@/hooks/usePageTitle';

export function ReceptionDashboard() {
  usePageTitle(t('dashboards.reception.title'));
  const { profile } = useAuth();

  // Queries
  const { data: awaitingAssignData, isLoading: loadingAssign, refetch: refetchAssign } = useCases({
    status: 'awaiting_assignment',
    pageSize: 20,
  });
  const { data: awaitingReceiptData, isLoading: loadingReceipt, refetch: refetchReceipt } = useCases({
    status: 'awaiting_reception_receipt',
    pageSize: 20,
  });
  const { data: readyPickupData, isLoading: loadingPickup, refetch: refetchPickup } = useCases({
    status: 'received_by_reception',
    pageSize: 20,
  });
  const { data: technicians } = useTechnicians();

  // Mutations
  const updateStatus = useUpdateCaseStatus();
  const assignTechnician = useAssignTechnician();

  // Assign Tech Dialog
  const [assignCase, setAssignCase] = useState<Case | null>(null);
  const [selectedTechId, setSelectedTechId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const awaitingAssignCases = awaitingAssignData?.data || [];
  const awaitingReceiptCases = awaitingReceiptData?.data || [];
  const readyPickupCases = readyPickupData?.data || [];

  const handleRefetchAll = () => {
    refetchAssign();
    refetchReceipt();
    refetchPickup();
  };

  const handleAssign = async () => {
    if (!assignCase || !selectedTechId || !profile) return;
    try {
      setSubmitting(true);
      await assignTechnician.mutateAsync({
        caseId: assignCase.id,
        technicianId: selectedTechId,
      });
      toast.success(t('dashboards.reception.toasts.assigned', { caseNumber: assignCase.case_number }));
      setAssignCase(null);
      setSelectedTechId('');
      handleRefetchAll();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReceiveFromTech = async (c: Case) => {
    try {
      await updateStatus.mutateAsync({
        caseId: c.id,
        newStatus: 'received_by_reception',
        notes: t('dashboards.reception.notes.received'),
      });
      toast.success(t('dashboards.reception.toasts.received', { caseNumber: c.case_number }));
      handleRefetchAll();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    }
  };

  const handleReleaseToRep = async (c: Case) => {
    try {
      await updateStatus.mutateAsync({
        caseId: c.id,
        newStatus: 'awaiting_representative_pickup',
        notes: t('dashboards.reception.notes.staged'),
      });
      toast.success(t('dashboards.reception.toasts.staged', { caseNumber: c.case_number }));
      handleRefetchAll();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('dashboards.reception.title')}</h1>
          <p className="text-sm text-slate-500">{t('dashboards.reception.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefetchAll}>
            <RefreshCw className="h-4 w-4 me-1" />
            {t('common.actions.refresh')}
          </Button>
          <Link to="/cases/new">
            <Button size="sm">
              <Plus className="h-4 w-4 me-1" />
              {t('dashboards.reception.registerCase')}
            </Button>
          </Link>
          <Link to="/batches">
            <Button variant="secondary" size="sm">
              <Package className="h-4 w-4 me-1" />
              {t('dashboards.reception.batches')}
            </Button>
          </Link>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-s-4 border-s-amber-500">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500 font-medium">{t('dashboards.reception.metrics.awaitingAssignment')}</span>
              <div className="text-2xl font-bold text-amber-700 mt-0.5">
                {awaitingAssignCases.length}
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <UserCheck className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-s-4 border-s-blue-500">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500 font-medium">{t('dashboards.reception.metrics.awaitingReceipt')}</span>
              <div className="text-2xl font-bold text-blue-700 mt-0.5">
                {awaitingReceiptCases.length}
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Inbox className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-s-4 border-s-emerald-500">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500 font-medium">{t('dashboards.reception.metrics.readyForPickup')}</span>
              <div className="text-2xl font-bold text-emerald-700 mt-0.5">
                {readyPickupCases.length}
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Truck className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section 1: Cases Awaiting Assignment */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-amber-600" />
            {t('dashboards.reception.sections.awaitingAssignment', { count: awaitingAssignCases.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingAssign ? (
            <div className="py-8 flex justify-center"><Spinner size="md" /></div>
          ) : awaitingAssignCases.length === 0 ? (
            <p className="p-4 text-xs text-slate-500 text-center">{t('dashboards.reception.empty.awaitingAssignment')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.labels.caseNumber')}</TableHead>
                  <TableHead>{t('common.labels.patient')}</TableHead>
                  <TableHead>{t('common.labels.dentist')}</TableHead>
                  <TableHead>{t('common.labels.type')}</TableHead>
                  <TableHead>{t('dashboards.reception.columns.targetDue')}</TableHead>
                  <TableHead className="text-end">{t('common.labels.action')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {awaitingAssignCases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-semibold text-brand-teal whitespace-nowrap">
                      <Link to={`/cases/${c.id}`} className="hover:underline"><CaseNumber value={c.case_number} /></Link>
                    </TableCell>
                    <TableCell className="font-medium text-slate-900"><AutoDir>{c.patient_name}</AutoDir></TableCell>
                    <TableCell className="text-slate-700"><AutoDir>{c.dentist?.name || c.dentist_name_text || '—'}</AutoDir></TableCell>
                    <TableCell className="text-slate-800">{caseTypeLabel(c.case_type)}</TableCell>
                    <TableCell className="text-xs text-slate-600 whitespace-nowrap">{c.due_date ? formatDate(c.due_date) : '—'}</TableCell>
                    <TableCell className="text-end">
                      <Button
                        size="sm"
                        onClick={() => {
                          setAssignCase(c);
                          setSelectedTechId('');
                        }}
                      >
                        <UserCheck className="h-3.5 w-3.5 me-1" />
                        {t('dashboards.reception.assignTech')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Cases Submitted by Techs (Awaiting Reception Receipt) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Inbox className="h-4 w-4 text-blue-600" />
            {t('dashboards.reception.sections.awaitingReceipt', { count: awaitingReceiptCases.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingReceipt ? (
            <div className="py-8 flex justify-center"><Spinner size="md" /></div>
          ) : awaitingReceiptCases.length === 0 ? (
            <p className="p-4 text-xs text-slate-500 text-center">{t('dashboards.reception.empty.awaitingReceipt')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.labels.caseNumber')}</TableHead>
                  <TableHead>{t('common.labels.patient')}</TableHead>
                  <TableHead>{t('common.labels.technician')}</TableHead>
                  <TableHead>{t('common.labels.dentist')}</TableHead>
                  <TableHead className="text-end">{t('common.labels.action')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {awaitingReceiptCases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-semibold text-brand-teal whitespace-nowrap">
                      <Link to={`/cases/${c.id}`} className="hover:underline"><CaseNumber value={c.case_number} /></Link>
                    </TableCell>
                    <TableCell className="font-medium text-slate-900"><AutoDir>{c.patient_name}</AutoDir></TableCell>
                    <TableCell className="text-slate-800 font-medium"><AutoDir>{c.assigned_technician?.full_name || '—'}</AutoDir></TableCell>
                    <TableCell className="text-slate-700"><AutoDir>{c.dentist?.name || c.dentist_name_text || '—'}</AutoDir></TableCell>
                    <TableCell className="text-end">
                      <Button
                        size="sm"
                        onClick={() => handleReceiveFromTech(c)}
                      >
                        <CheckCircle className="h-3.5 w-3.5 me-1" />
                        {t('dashboards.reception.receive')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Section 3: Ready for Representative Pickup */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="h-4 w-4 text-emerald-600" />
            {t('dashboards.reception.sections.inReception', { count: readyPickupCases.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingPickup ? (
            <div className="py-8 flex justify-center"><Spinner size="md" /></div>
          ) : readyPickupCases.length === 0 ? (
            <p className="p-4 text-xs text-slate-500 text-center">{t('dashboards.reception.empty.inReception')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.labels.caseNumber')}</TableHead>
                  <TableHead>{t('common.labels.patient')}</TableHead>
                  <TableHead>{t('dashboards.reception.columns.clinicDestination')}</TableHead>
                  <TableHead>{t('common.labels.status')}</TableHead>
                  <TableHead className="text-end">{t('common.labels.action')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {readyPickupCases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-semibold text-brand-teal whitespace-nowrap">
                      <Link to={`/cases/${c.id}`} className="hover:underline"><CaseNumber value={c.case_number} /></Link>
                    </TableCell>
                    <TableCell className="font-medium text-slate-900"><AutoDir>{c.patient_name}</AutoDir></TableCell>
                    <TableCell className="text-slate-800">
                      <AutoDir>{c.dentist?.clinic_name || c.dentist?.name || c.clinic_name_text || '—'}</AutoDir>
                    </TableCell>
                    <TableCell><StatusBadge status={c.current_status} /></TableCell>
                    <TableCell className="text-end">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleReleaseToRep(c)}
                      >
                        <Send className="h-3.5 w-3.5 me-1 rtl:-scale-x-100" />
                        {t('dashboards.reception.stage')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Assign Dialog */}
      <Dialog open={!!assignCase} onOpenChange={(open) => !open && setAssignCase(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboards.reception.assignDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-600">
              {tx('dashboards.reception.assignDialog.body', {
                caseNumber: <strong className="text-slate-900"><CaseNumber value={assignCase?.case_number} /></strong>,
              })}
            </p>
            <div>
              <Select
                label={t('dashboards.reception.assignDialog.selectLabel')}
                value={selectedTechId}
                onChange={(e) => setSelectedTechId(e.target.value)}
                options={[
                  { value: '', label: t('common.select.chooseTechnician') },
                  ...(technicians || []).map((tech) => ({
                    value: tech.id,
                    label: tech.full_name,
                  })),
                ]}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssignCase(null)}>{t('common.actions.cancel')}</Button>
            <Button onClick={handleAssign} disabled={!selectedTechId || submitting}>
              {submitting ? t('common.states.assigning') : t('dashboards.reception.assignDialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
