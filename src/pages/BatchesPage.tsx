import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  useBatches,
  useCreateBatch,
  useUpdateBatch,
  useBatchCases,
  useAddCaseToBatch,
  useRepresentatives,
  useCases,
} from '@/hooks/useSupabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AutoDir, CaseNumber, Ltr } from '@/components/ui/Bidi';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import {
  BATCH_TYPE_LABELS,
  BATCH_TYPE_LONG_LABELS,
  BATCH_STATUS_LABELS,
  caseTypeLabel,
  type Case,
  type DeliveryBatch,
  type BatchType,
  type BatchStatus,
} from '@/types/database';
import { formatDate } from '@/lib/utils';
import {
  Plus,
  CheckCircle,
  AlertTriangle,
  Clock,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { tx } from '@/i18n/rich';
import { errorMessage } from '@/i18n/errors';
import { usePageTitle } from '@/hooks/usePageTitle';

export function BatchesPage() {
  usePageTitle(t('batches.title'));
  const { profile } = useAuth();
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [page, setPage] = useState(1);

  // Queries
  const { data: batchesData, isLoading, refetch } = useBatches({
    type: filterType || undefined,
    status: filterStatus || undefined,
    page,
    pageSize: 15,
  });
  const { data: representatives } = useRepresentatives();

  // Mutations
  const createBatch = useCreateBatch();
  const updateBatch = useUpdateBatch();
  const addCaseToBatch = useAddCaseToBatch();

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [batchType, setBatchType] = useState<BatchType>('intake');
  const [batchRef, setBatchRef] = useState('');
  const [repId, setRepId] = useState('');
  const [expectedCount, setExpectedCount] = useState('');
  const [createNotes, setCreateNotes] = useState('');

  // Selected batch for details & adding cases
  const [selectedBatch, setSelectedBatch] = useState<DeliveryBatch | null>(null);
  const { data: batchCases, isLoading: casesLoading } = useBatchCases(selectedBatch?.id);

  // Add Case modal
  const [addCaseModalOpen, setAddCaseModalOpen] = useState(false);
  const [caseSearchTerm, setCaseSearchTerm] = useState('');
  const { data: availableCases } = useCases({ search: caseSearchTerm, pageSize: 10 });
  const [selectedCaseId, setSelectedCaseId] = useState('');

  // Close Batch Modal
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [discrepancyNote, setDiscrepancyNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canManage = profile?.role === 'owner' || profile?.role === 'receptionist';

  const handleOpenCreateModal = () => {
    const timestamp = Date.now().toString().slice(-6);
    setBatchRef(`BATCH-${timestamp}`);
    setBatchType('intake');
    setRepId('');
    setExpectedCount('');
    setCreateNotes('');
    setCreateModalOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    try {
      setSubmitting(true);
      await createBatch.mutateAsync({
        batch_reference: batchRef.trim() || `BATCH-${Date.now().toString().slice(-6)}`,
        batch_type: batchType,
        status: 'open' as BatchStatus,
        representative_id: repId || null,
        receptionist_id: profile.role === 'receptionist' ? profile.id : null,
        expected_count: expectedCount ? parseInt(expectedCount, 10) : null,
        actual_count: 0,
        notes: createNotes.trim() || null,
        handoff_at: new Date().toISOString(),
      });
      toast.success(t('batches.toasts.created'));
      setCreateModalOpen(false);
      refetch();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddCaseSubmit = async () => {
    if (!selectedBatch || !selectedCaseId || !profile) return;
    try {
      setSubmitting(true);
      await addCaseToBatch.mutateAsync({
        batchId: selectedBatch.id,
        caseId: selectedCaseId,
      });
      toast.success(t('batches.toasts.caseAdded'));
      setSelectedCaseId('');
      setAddCaseModalOpen(false);
      refetch();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseBatchSubmit = async () => {
    if (!selectedBatch) return;
    try {
      setSubmitting(true);
      const isDiscrepancy =
        selectedBatch.expected_count !== null &&
        selectedBatch.actual_count !== selectedBatch.expected_count;

      await updateBatch.mutateAsync({
        id: selectedBatch.id,
        status: isDiscrepancy ? 'discrepancy' : 'closed',
        confirmed_at: new Date().toISOString(),
        discrepancy_notes: isDiscrepancy ? discrepancyNote || t('batches.finalizeDialog.defaultMismatchNote') : null,
      });

      toast.success(t('batches.toasts.finalized', { reference: selectedBatch.batch_reference }));
      setCloseModalOpen(false);
      setSelectedBatch(null);
      refetch();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const batches = batchesData?.data || [];
  const totalCount = batchesData?.count || 0;
  const totalPages = Math.ceil(totalCount / 15);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('batches.title')}</h1>
          <p className="text-sm text-slate-500">{t('batches.subtitle')}</p>
        </div>
        {canManage && (
          <Button onClick={handleOpenCreateModal} size="sm">
            <Plus className="h-4 w-4 me-1" />
            {t('batches.create')}
          </Button>
        )}
      </div>

      {/* Filter Toolbar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-64">
              <Select
                aria-label={t('common.labels.type')}
                value={filterType}
                onChange={(e) => {
                  setFilterType(e.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: t('batches.allTypes') },
                  { value: 'intake', label: BATCH_TYPE_LONG_LABELS.intake },
                  { value: 'return', label: BATCH_TYPE_LONG_LABELS.return },
                ]}
              />
            </div>

            <div className="w-48">
              <Select
                aria-label={t('common.labels.status')}
                value={filterStatus}
                onChange={(e) => {
                  setFilterStatus(e.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: t('batches.allStatuses') },
                  { value: 'open', label: BATCH_STATUS_LABELS.open },
                  { value: 'closed', label: BATCH_STATUS_LABELS.closed },
                  { value: 'discrepancy', label: BATCH_STATUS_LABELS.discrepancy },
                ]}
              />
            </div>

            {(filterType || filterStatus) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilterType('');
                  setFilterStatus('');
                  setPage(1);
                }}
              >
                {t('common.actions.clearFilters')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Batches Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : batches.length === 0 ? (
            <EmptyState
              title={t('batches.empty.title')}
              description={t('batches.empty.description')}
              actionLabel={canManage ? t('batches.empty.action') : undefined}
              onAction={canManage ? handleOpenCreateModal : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('batches.columns.reference')}</TableHead>
                    <TableHead>{t('common.labels.type')}</TableHead>
                    <TableHead>{t('common.labels.representative')}</TableHead>
                    <TableHead>{t('batches.columns.expectedActual')}</TableHead>
                    <TableHead>{t('common.labels.status')}</TableHead>
                    <TableHead>{t('batches.columns.handoffDate')}</TableHead>
                    <TableHead className="text-end">{t('common.labels.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((b) => {
                    const hasDiscrepancy =
                      b.expected_count !== null && b.actual_count !== b.expected_count;

                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono font-semibold text-slate-900 whitespace-nowrap">
                          <Ltr>{b.batch_reference}</Ltr>
                        </TableCell>
                        <TableCell>
                          <Badge variant={b.batch_type === 'intake' ? 'secondary' : 'default'}>
                            {BATCH_TYPE_LABELS[b.batch_type]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {b.representative?.full_name ? (
                            <AutoDir>{b.representative.full_name}</AutoDir>
                          ) : (
                            <span className="text-slate-500 text-xs">{t('common.labels.unassigned')}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {/* actual / expected, kept left-to-right like a fraction */}
                          <div className="flex items-center gap-1.5 text-sm">
                            <Ltr className="inline-flex items-center gap-1.5">
                              <span className="font-medium text-slate-900">{b.actual_count}</span>
                              <span className="text-slate-500">/</span>
                              <span className="text-slate-600">
                                {b.expected_count !== null ? b.expected_count : '—'}
                              </span>
                            </Ltr>
                            {hasDiscrepancy && b.status !== 'open' && (
                              <span title={t('batches.countDiscrepancy')}>
                                <AlertTriangle className="h-4 w-4 text-amber-500" aria-label={t('batches.countDiscrepancy')} />
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {b.status === 'open' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                              <Clock className="h-3 w-3" />
                              {BATCH_STATUS_LABELS.open}
                            </span>
                          )}
                          {b.status === 'closed' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">
                              <CheckCircle className="h-3 w-3" />
                              {BATCH_STATUS_LABELS.closed}
                            </span>
                          )}
                          {b.status === 'discrepancy' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                              <AlertTriangle className="h-3 w-3" />
                              {BATCH_STATUS_LABELS.discrepancy}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600 whitespace-nowrap">
                          {formatDate(b.handoff_at)}
                        </TableCell>
                        <TableCell className="text-end">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSelectedBatch(b)}
                          >
                            <Layers className="h-4 w-4 me-1" />
                            {t('batches.manageCases')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="p-4 border-t border-slate-100">
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={(p) => setPage(p)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Batch Details & Cases Dialog */}
      <Dialog
        open={!!selectedBatch}
        onOpenChange={(open) => !open && setSelectedBatch(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2">
              <span>
                {tx('batches.detail.title', {
                  reference: <Ltr className="font-mono">{selectedBatch?.batch_reference}</Ltr>,
                })}
              </span>
              {selectedBatch && (
                <Badge variant="outline" className="text-xs">
                  {BATCH_TYPE_LABELS[selectedBatch.batch_type]}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50 p-3 rounded-lg text-xs">
              <div>
                <span className="text-slate-500 block">{t('common.labels.representative')}</span>
                <span className="font-semibold text-slate-800">
                  {selectedBatch?.representative?.full_name ? (
                    <AutoDir>{selectedBatch.representative.full_name}</AutoDir>
                  ) : (
                    t('common.labels.notSet')
                  )}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">{t('batches.detail.expected')}</span>
                <span className="font-semibold text-slate-800">
                  {selectedBatch?.expected_count ?? t('common.labels.notSet')}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">{t('batches.detail.actual')}</span>
                <span className="font-semibold text-slate-800">
                  {selectedBatch?.actual_count || 0}
                </span>
              </div>
            </div>

            {selectedBatch?.notes && (
              <div className="text-xs text-slate-600 bg-amber-50/50 p-2.5 rounded border border-amber-100">
                <strong>{t('batches.detail.notesLabel')}</strong> <AutoDir>{selectedBatch.notes}</AutoDir>
              </div>
            )}

            {/* Cases in Batch */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-700">
                  {t('batches.detail.associated')}
                </h4>
                {selectedBatch?.status === 'open' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSelectedCaseId('');
                      setAddCaseModalOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 me-1" />
                    {t('batches.detail.addCase')}
                  </Button>
                )}
              </div>

              {casesLoading ? (
                <div className="py-6 flex justify-center">
                  <Spinner size="sm" />
                </div>
              ) : !batchCases || batchCases.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center border border-dashed rounded-lg">
                  {t('batches.detail.noCases')}
                </p>
              ) : (
                <div className="max-h-60 overflow-y-auto border rounded-lg divide-y text-xs">
                  {(batchCases as Array<{ id: string; case?: Case | null }>).map((bc) => (
                    <div key={bc.id} className="p-2.5 flex items-center justify-between gap-2 hover:bg-slate-50">
                      <div className="min-w-0">
                        <span className="font-semibold text-slate-900 block">
                          <CaseNumber value={bc.case?.case_number} />
                        </span>
                        <span className="text-slate-500">
                          {t('batches.detail.caseLine', {
                            patient: bc.case?.patient_name ?? '—',
                            caseType: caseTypeLabel(bc.case?.case_type),
                          })}
                        </span>
                      </div>
                      {bc.case?.current_status && <StatusBadge status={bc.case.current_status} className="text-[10px]" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between">
            <div>
              {selectedBatch?.status === 'open' && canManage && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setCloseModalOpen(true)}
                >
                  <CheckCircle className="h-4 w-4 me-1" />
                  {t('batches.detail.finalize')}
                </Button>
              )}
            </div>
            <Button variant="ghost" onClick={() => setSelectedBatch(null)}>
              {t('common.actions.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Case to Batch Dialog */}
      <Dialog
        open={addCaseModalOpen}
        onOpenChange={(open) => !open && setAddCaseModalOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('batches.addCaseDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Input
              label={t('batches.addCaseDialog.search')}
              placeholder={t('batches.addCaseDialog.searchPlaceholder')}
              value={caseSearchTerm}
              onChange={(e) => setCaseSearchTerm(e.target.value)}
            />

            <Select
              label={t('batches.addCaseDialog.select')}
              value={selectedCaseId}
              onChange={(e) => setSelectedCaseId(e.target.value)}
              options={[
                { value: '', label: t('batches.addCaseDialog.selectPlaceholder') },
                ...(availableCases?.data || []).map((c) => ({
                  value: c.id,
                  label: t('batches.addCaseDialog.option', {
                    caseNumber: c.case_number,
                    patient: c.patient_name,
                    caseType: caseTypeLabel(c.case_type),
                  }),
                })),
              ]}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddCaseModalOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              onClick={handleAddCaseSubmit}
              disabled={!selectedCaseId || submitting}
            >
              {submitting ? t('common.states.adding') : t('batches.addCaseDialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Finalize Batch Dialog */}
      <Dialog
        open={closeModalOpen}
        onOpenChange={(open) => !open && setCloseModalOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('batches.finalizeDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 text-sm text-slate-600">
            <p>
              {tx('batches.finalizeDialog.body', {
                reference: <strong className="text-slate-900 font-mono"><Ltr>{selectedBatch?.batch_reference}</Ltr></strong>,
              })}
            </p>

            <div className="p-3 bg-slate-50 rounded border text-xs space-y-0.5">
              <div>
                {tx('batches.finalizeDialog.expected', {
                  count: <strong>{selectedBatch?.expected_count ?? t('common.labels.notSet')}</strong>,
                })}
              </div>
              <div>
                {tx('batches.finalizeDialog.actual', {
                  count: <strong>{selectedBatch?.actual_count || 0}</strong>,
                })}
              </div>
              {selectedBatch?.expected_count !== null &&
                selectedBatch?.actual_count !== selectedBatch?.expected_count && (
                  <div className="text-red-600 font-bold mt-1 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {t('batches.finalizeDialog.mismatch')}
                  </div>
                )}
            </div>

            <Textarea
              label={t('batches.finalizeDialog.notesLabel')}
              placeholder={t('batches.finalizeDialog.notesPlaceholder')}
              rows={3}
              value={discrepancyNote}
              onChange={(e) => setDiscrepancyNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCloseModalOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button onClick={handleCloseBatchSubmit} disabled={submitting}>
              {submitting ? t('common.states.finalizing') : t('batches.finalizeDialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Batch Dialog */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('batches.createDialog.title')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4 py-2">
            <Input
              label={t('batches.createDialog.reference')}
              dir="ltr"
              className="text-end"
              value={batchRef}
              onChange={(e) => setBatchRef(e.target.value)}
              placeholder={t('batches.createDialog.referencePlaceholder')}
              required
            />

            <Select
              label={t('batches.createDialog.type')}
              value={batchType}
              onChange={(e) => setBatchType(e.target.value as BatchType)}
              options={[
                { value: 'intake', label: BATCH_TYPE_LONG_LABELS.intake },
                { value: 'return', label: BATCH_TYPE_LONG_LABELS.return },
              ]}
            />

            <Select
              label={t('batches.createDialog.representative')}
              value={repId}
              onChange={(e) => setRepId(e.target.value)}
              options={[
                { value: '', label: t('batches.createDialog.selectRepresentative') },
                ...(representatives || []).map((r) => ({
                  value: r.id,
                  label: r.full_name,
                })),
              ]}
            />

            <Input
              label={t('batches.createDialog.expectedCount')}
              type="number"
              min="0"
              value={expectedCount}
              onChange={(e) => setExpectedCount(e.target.value)}
              placeholder={t('batches.createDialog.expectedPlaceholder')}
            />

            <Textarea
              label={t('common.labels.notes')}
              rows={2}
              value={createNotes}
              onChange={(e) => setCreateNotes(e.target.value)}
              placeholder={t('batches.createDialog.notesPlaceholder')}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateModalOpen(false)}
              >
                {t('common.actions.cancel')}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? t('common.states.creating') : t('batches.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
