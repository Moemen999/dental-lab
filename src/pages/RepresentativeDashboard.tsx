import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useCases, useUpdateCaseStatus, useBatches } from '@/hooks/useSupabase';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
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
import type { Case } from '@/types/database';
import {
  Truck,
  Package,
  CheckCircle,
  Clock,
  MapPin,
  RefreshCw,
  Phone,
} from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { tx } from '@/i18n/rich';
import { errorMessage } from '@/i18n/errors';
import { usePageTitle } from '@/hooks/usePageTitle';

export function RepresentativeDashboard() {
  usePageTitle(t('dashboards.representative.title'));
  const { profile } = useAuth();

  // Queries
  const { data: pickupData, isLoading: loadingPickup, refetch: refetchPickup } = useCases({
    status: 'awaiting_representative_pickup',
    pageSize: 30,
  });
  const { data: inTransitData, isLoading: loadingTransit, refetch: refetchTransit } = useCases({
    status: 'with_representative',
    pageSize: 30,
  });
  const { data: myBatchesData, refetch: refetchBatches } = useBatches({
    status: 'open',
    pageSize: 10,
  });

  const updateStatus = useUpdateCaseStatus();

  // Delivery confirmation dialog
  const [deliverCase, setDeliverCase] = useState<Case | null>(null);
  const [deliveryNote, setDeliveryNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const pickupCases = pickupData?.data || [];
  const inTransitCases = inTransitData?.data || [];
  const openBatches = myBatchesData?.data || [];

  const handleRefetchAll = () => {
    refetchPickup();
    refetchTransit();
    refetchBatches();
  };

  const handlePickUp = async (c: Case) => {
    try {
      await updateStatus.mutateAsync({
        caseId: c.id,
        newStatus: 'with_representative',
        notes: t('dashboards.representative.notes.pickedUp', { name: profile?.full_name || '' }),
      });
      toast.success(t('dashboards.representative.toasts.pickedUp', { caseNumber: c.case_number }));
      handleRefetchAll();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    }
  };

  const handleConfirmDelivery = async () => {
    if (!deliverCase) return;
    try {
      setSubmitting(true);
      await updateStatus.mutateAsync({
        caseId: deliverCase.id,
        newStatus: 'delivered',
        notes: deliveryNote
          ? t('dashboards.representative.notes.deliveredWithNote', { note: deliveryNote })
          : t('dashboards.representative.notes.delivered'),
      });
      toast.success(t('dashboards.representative.toasts.delivered', { caseNumber: deliverCase.case_number }));
      setDeliverCase(null);
      setDeliveryNote('');
      handleRefetchAll();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('dashboards.representative.title')}</h1>
          <p className="text-sm text-slate-500">{t('dashboards.representative.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefetchAll}>
            <RefreshCw className="h-4 w-4 me-1" />
            {t('common.actions.refresh')}
          </Button>
          <Link to="/batches">
            <Button size="sm">
              <Package className="h-4 w-4 me-1" />
              {t('dashboards.representative.deliveryBatches')}
            </Button>
          </Link>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-s-4 border-s-amber-500">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500 font-medium">{t('dashboards.representative.metrics.awaitingPickup')}</span>
              <div className="text-2xl font-bold text-amber-700 mt-0.5">
                {pickupCases.length}
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <Clock className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-s-4 border-s-blue-500">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500 font-medium">{t('dashboards.representative.metrics.inTransit')}</span>
              <div className="text-2xl font-bold text-blue-700 mt-0.5">
                {inTransitCases.length}
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Truck className="h-5 w-5 rtl:-scale-x-100" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-s-4 border-s-purple-500">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500 font-medium">{t('dashboards.representative.metrics.openBatches')}</span>
              <div className="text-2xl font-bold text-purple-700 mt-0.5">
                {openBatches.length}
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
              <Package className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section 1: In Transit Cases (With Representative) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="h-4 w-4 text-blue-600 rtl:-scale-x-100" />
            {t('dashboards.representative.sections.inTransit', { count: inTransitCases.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingTransit ? (
            <div className="py-8 flex justify-center"><Spinner size="md" /></div>
          ) : inTransitCases.length === 0 ? (
            <p className="p-4 text-xs text-slate-500 text-center">{t('dashboards.representative.empty.inTransit')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.labels.caseNumber')}</TableHead>
                  <TableHead>{t('common.labels.patient')}</TableHead>
                  <TableHead>{t('dashboards.representative.columns.destination')}</TableHead>
                  <TableHead>{t('dashboards.representative.columns.contact')}</TableHead>
                  <TableHead className="text-end">{t('common.labels.action')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inTransitCases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-semibold text-brand-teal whitespace-nowrap">
                      <Link to={`/cases/${c.id}`} className="hover:underline"><CaseNumber value={c.case_number} /></Link>
                    </TableCell>
                    <TableCell className="font-medium text-slate-900"><AutoDir>{c.patient_name}</AutoDir></TableCell>
                    <TableCell>
                      <div className="font-semibold text-slate-900">
                        <AutoDir>{c.dentist?.clinic_name || c.clinic_name_text || t('common.labels.defaultClinic')}</AutoDir>
                      </div>
                      <div className="text-xs text-slate-500">
                        <AutoDir>{c.dentist?.name || c.dentist_name_text || t('common.labels.defaultDentist')}</AutoDir>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {c.dentist?.address && (
                        <div className="flex items-center gap-1 mb-0.5">
                          <MapPin className="h-3 w-3 text-slate-500 shrink-0" />
                          <AutoDir>{c.dentist.address}</AutoDir>
                        </div>
                      )}
                      {c.dentist?.phone && (
                        <div className="flex items-center gap-1">
                          <Phone className="h-3 w-3 text-slate-500 shrink-0" />
                          <Ltr>{c.dentist.phone}</Ltr>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        size="sm"
                        onClick={() => {
                          setDeliverCase(c);
                          setDeliveryNote('');
                        }}
                      >
                        <CheckCircle className="h-3.5 w-3.5 me-1" />
                        {t('dashboards.representative.markDelivered')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Ready for Pickup from Lab */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600" />
            {t('dashboards.representative.sections.readyForPickup', { count: pickupCases.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingPickup ? (
            <div className="py-8 flex justify-center"><Spinner size="md" /></div>
          ) : pickupCases.length === 0 ? (
            <p className="p-4 text-xs text-slate-500 text-center">{t('dashboards.representative.empty.readyForPickup')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.labels.caseNumber')}</TableHead>
                  <TableHead>{t('common.labels.patient')}</TableHead>
                  <TableHead>{t('dashboards.representative.columns.destinationDentist')}</TableHead>
                  <TableHead>{t('common.labels.status')}</TableHead>
                  <TableHead className="text-end">{t('common.labels.action')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pickupCases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-semibold text-brand-teal whitespace-nowrap">
                      <Link to={`/cases/${c.id}`} className="hover:underline"><CaseNumber value={c.case_number} /></Link>
                    </TableCell>
                    <TableCell className="font-medium text-slate-900"><AutoDir>{c.patient_name}</AutoDir></TableCell>
                    <TableCell className="text-slate-800">
                      {c.dentist?.clinic_name
                        ? t('dashboards.representative.clinicWithDentist', {
                            clinic: c.dentist.clinic_name,
                            dentist: c.dentist.name,
                          })
                        : <AutoDir>{c.dentist?.name || '—'}</AutoDir>}
                    </TableCell>
                    <TableCell><StatusBadge status={c.current_status} /></TableCell>
                    <TableCell className="text-end">
                      <Button
                        size="sm"
                        onClick={() => handlePickUp(c)}
                      >
                        <Truck className="h-3.5 w-3.5 me-1 rtl:-scale-x-100" />
                        {t('dashboards.representative.pickUp')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Confirm Delivery Dialog */}
      <Dialog open={!!deliverCase} onOpenChange={(open) => !open && setDeliverCase(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboards.representative.dialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-600">
              {tx('dashboards.representative.dialog.body', {
                caseNumber: <strong className="text-slate-900"><CaseNumber value={deliverCase?.case_number} /></strong>,
                clinic: (
                  <strong className="text-slate-900">
                    {deliverCase?.dentist?.clinic_name || deliverCase?.dentist?.name || t('dashboards.representative.dialog.theClinic')}
                  </strong>
                ),
              })}
            </p>

            <Textarea
              label={t('dashboards.representative.dialog.notesLabel')}
              rows={2}
              placeholder={t('dashboards.representative.dialog.notesPlaceholder')}
              value={deliveryNote}
              onChange={(e) => setDeliveryNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeliverCase(null)}>{t('common.actions.cancel')}</Button>
            <Button onClick={handleConfirmDelivery} disabled={submitting}>
              {submitting ? t('common.states.confirming') : t('dashboards.representative.dialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
