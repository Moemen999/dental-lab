import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  useCases,
  useTechnicians,
  useAssignTechnician,
  useUpdateCaseStatus,
  type CaseFilters,
} from '@/hooks/useSupabase';
import { Button, buttonVariants } from '@/components/ui/Button';
import {
  MobileList,
  MobileListItem,
  MobileItemHeader,
  MobileFields,
  MobileField,
  MobileActions,
  DesktopTable,
} from '@/components/ui/ResponsiveList';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card, CardContent } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { AutoDir, CaseNumber } from '@/components/ui/Bidi';
import { JawText, LegacySpecsLine } from '@/components/CaseJawSpecs';
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
  CASE_STATUS_LABELS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  transitionsForRole,
  caseTypeLabel,
  type Case,
  type CaseStatus,
  type CasePriority,
} from '@/types/database';
import { cn, formatDate, isOverdue } from '@/lib/utils';
import { Plus, Search, UserCheck, Eye, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { tx } from '@/i18n/rich';
import { errorMessage } from '@/i18n/errors';
import { usePageTitle } from '@/hooks/usePageTitle';

function PriorityPill({ priority }: { priority: CasePriority }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[priority]}`}>
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

function DentistClinic({ c }: { c: Case }) {
  return (
    <>
      <div className="text-slate-900">
        <AutoDir>{c.dentist?.name || c.dentist_name_text || '—'}</AutoDir>
      </div>
      {(c.dentist?.clinic_name || c.clinic_name_text) && (
        <div className="text-xs text-slate-500">
          <AutoDir>{c.dentist?.clinic_name || c.clinic_name_text}</AutoDir>
        </div>
      )}
    </>
  );
}

function TypeDetails({ c }: { c: Case }) {
  return (
    <>
      <div className="text-slate-900 font-medium">{caseTypeLabel(c.case_type)}</div>
      <JawText value={c} className="block text-xs font-medium text-slate-700" />
      <LegacySpecsLine value={c} className="block text-xs" />
    </>
  );
}

function TechnicianName({ c }: { c: Case }) {
  return c.assigned_technician ? (
    <span className="text-sm text-slate-800">
      <AutoDir>{c.assigned_technician.full_name}</AutoDir>
    </span>
  ) : (
    <span className="text-xs text-slate-500">{t('common.labels.unassigned')}</span>
  );
}

function DueDate({ c, overdue }: { c: Case; overdue: boolean }) {
  return c.due_date ? (
    <div className={`text-sm whitespace-nowrap ${overdue ? 'text-red-600 font-semibold' : 'text-slate-700'}`}>
      {formatDate(c.due_date)}
      {overdue && <span className="block text-xs font-bold text-red-700">{t('common.labels.overdue')}</span>}
    </div>
  ) : (
    <span className="text-xs text-slate-500">—</span>
  );
}

export function CasesPage() {
  usePageTitle(t('layout.nav.cases'));
  const { profile } = useAuth();
  const [filters, setFilters] = useState<CaseFilters>({
    page: 1,
    pageSize: 15,
  });
  const [searchTerm, setSearchTerm] = useState('');

  // Data fetching
  const { data: casesData, isLoading, refetch } = useCases({
    ...filters,
    search: searchTerm || undefined,
  });
  const { data: technicians } = useTechnicians();

  // Mutations
  const assignTechnician = useAssignTechnician();
  const updateStatus = useUpdateCaseStatus();

  // Modals state
  const [assignModalCase, setAssignModalCase] = useState<Case | null>(null);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState('');
  const [statusModalCase, setStatusModalCase] = useState<Case | null>(null);
  const [newStatus, setNewStatus] = useState<CaseStatus | ''>('');
  const [statusNotes, setStatusNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canRegister = profile?.role === 'owner' || profile?.role === 'receptionist';
  const canAssign = profile?.role === 'owner' || profile?.role === 'receptionist';

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters((prev) => ({ ...prev, page: 1, search: searchTerm }));
  };

  const handleAssignSubmit = async () => {
    if (!assignModalCase || !selectedTechnicianId || !profile) return;
    try {
      setSubmitting(true);
      await assignTechnician.mutateAsync({
        caseId: assignModalCase.id,
        technicianId: selectedTechnicianId,
      });
      toast.success(t('cases.list.toasts.assigned', { caseNumber: assignModalCase.case_number }));
      setAssignModalCase(null);
      setSelectedTechnicianId('');
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusSubmit = async () => {
    if (!statusModalCase || !newStatus) return;
    try {
      setSubmitting(true);
      await updateStatus.mutateAsync({
        caseId: statusModalCase.id,
        newStatus,
        notes: statusNotes || undefined,
      });
      toast.success(
        t('cases.list.toasts.statusUpdated', {
          caseNumber: statusModalCase.case_number,
          status: CASE_STATUS_LABELS[newStatus],
        }),
      );
      setStatusModalCase(null);
      setNewStatus('');
      setStatusNotes('');
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const cases = casesData?.data || [];
  const totalCount = casesData?.count || 0;
  const totalPages = Math.ceil(totalCount / (filters.pageSize || 15));

  const technicianOptions = (technicians || []).map((tech) => ({
    value: tech.id,
    label: t('cases.list.technicianOption', { name: tech.full_name, email: tech.email }),
  }));

  // Shared by the phone card list and the table, so both open the same dialogs.
  const openAssign = (c: Case) => {
    setAssignModalCase(c);
    setSelectedTechnicianId(c.assigned_technician_id || '');
  };
  const openStatus = (c: Case, validTransitions: CaseStatus[]) => {
    setStatusModalCase(c);
    setNewStatus(validTransitions[0]);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 id="cases-title" className="text-2xl font-bold text-slate-900">{t('cases.list.title')}</h1>
          <p className="text-sm text-slate-500">{t('cases.list.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 me-1" />
            {t('common.actions.refresh')}
          </Button>
          {canRegister && (
            <Link to="/cases/new" className={buttonVariants({ size: 'sm' })}>
              <Plus className="h-4 w-4 me-1" aria-hidden="true" />
              {t('cases.list.newCase')}
            </Link>
          )}
        </div>
      </div>

      {/* Filter Toolbar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            {/* Search */}
            <form onSubmit={handleSearchSubmit} className="flex-1 flex gap-2" role="search">
              <div className="relative flex-1">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
                <Input
                  placeholder={t('cases.list.searchPlaceholder')}
                  aria-label={t('cases.list.searchPlaceholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="ps-9"
                />
              </div>
              <Button type="submit" variant="secondary" size="default">
                {t('common.actions.search')}
              </Button>
            </form>

            <div className="flex flex-wrap items-center gap-2">
              {/* Status filter */}
              <div className="w-48">
                <Select
                  aria-label={t('common.labels.status')}
                  value={filters.status || ''}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      page: 1,
                      status: (e.target.value as CaseStatus) || undefined,
                    }))
                  }
                  options={[
                    { value: '', label: t('cases.list.allStatuses') },
                    ...(Object.entries(CASE_STATUS_LABELS).map(([val, label]) => ({
                      value: val,
                      label,
                    }))),
                  ]}
                />
              </div>

              {/* Priority filter */}
              <div className="w-36">
                <Select
                  aria-label={t('common.labels.priority')}
                  value={filters.priority || ''}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      page: 1,
                      priority: (e.target.value as CasePriority) || undefined,
                    }))
                  }
                  options={[
                    { value: '', label: t('cases.list.allPriorities') },
                    ...(Object.entries(PRIORITY_LABELS).map(([val, label]) => ({
                      value: val,
                      label,
                    }))),
                  ]}
                />
              </div>

              {/* Technician filter */}
              {technicians && technicians.length > 0 && (
                <div className="w-44">
                  <Select
                    aria-label={t('common.labels.technician')}
                    value={filters.technician_id || ''}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        page: 1,
                        technician_id: e.target.value || undefined,
                      }))
                    }
                    options={[
                      { value: '', label: t('cases.list.allTechnicians') },
                      ...technicians.map((tech) => ({
                        value: tech.id,
                        label: tech.full_name,
                      })),
                    ]}
                  />
                </div>
              )}

              {/* Reset Filters */}
              {(filters.status || filters.priority || filters.technician_id || searchTerm) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchTerm('');
                    setFilters({ page: 1, pageSize: 15 });
                  }}
                >
                  {t('common.actions.clearFilters')}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Case Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : cases.length === 0 ? (
            <EmptyState
              title={t('cases.list.empty.title')}
              description={t('cases.list.empty.description')}
              actionLabel={canRegister ? t('cases.list.empty.action') : undefined}
              onAction={canRegister ? () => window.location.assign('/cases/new') : undefined}
            />
          ) : (
            <>
            {/* Phones (below md): one card per case instead of a table wider than the screen. */}
            <MobileList aria-labelledby="cases-title">
              {cases.map((c) => {
                const overdue = isOverdue(c.due_date, c.current_status);
                const validTransitions = transitionsForRole(profile?.role, c.current_status);

                return (
                  <MobileListItem key={c.id}>
                    <MobileItemHeader>
                      <Link
                        to={`/cases/${c.id}`}
                        className="text-sm font-semibold text-brand-teal hover:text-brand-teal-hover hover:underline"
                      >
                        <CaseNumber value={c.case_number} />
                      </Link>
                      <StatusBadge status={c.current_status} />
                    </MobileItemHeader>
                    <MobileFields>
                      <MobileField label={t('common.labels.patient')}>
                        <div className="font-medium text-slate-900"><AutoDir>{c.patient_name}</AutoDir></div>
                        {c.patient_age !== null && (
                          <div className="text-xs text-slate-500">{t('common.labels.age', { value: c.patient_age })}</div>
                        )}
                      </MobileField>
                      <MobileField label={t('cases.list.columns.dentistClinic')}><DentistClinic c={c} /></MobileField>
                      <MobileField label={t('cases.list.columns.typeDetails')}><TypeDetails c={c} /></MobileField>
                      <MobileField label={t('common.labels.priority')}><PriorityPill priority={c.priority} /></MobileField>
                      <MobileField label={t('cases.list.columns.assignedTech')}><TechnicianName c={c} /></MobileField>
                      <MobileField label={t('common.labels.dueDate')}><DueDate c={c} overdue={overdue} /></MobileField>
                    </MobileFields>
                    <MobileActions>
                      <Link
                        to={`/cases/${c.id}`}
                        className={cn(buttonVariants({ variant: 'outline' }), 'text-brand-teal')}
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        {t('common.actions.viewDetails')}
                      </Link>
                      {canAssign && (
                        <Button variant="outline" onClick={() => openAssign(c)}>
                          <UserCheck className="h-4 w-4" aria-hidden="true" />
                          {t('cases.list.assignTechnician')}
                        </Button>
                      )}
                      {validTransitions.length > 0 && (
                        <Button variant="secondary" onClick={() => openStatus(c, validTransitions)}>
                          {t('cases.list.updateStatus')}
                        </Button>
                      )}
                    </MobileActions>
                  </MobileListItem>
                );
              })}
            </MobileList>

            <DesktopTable>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common.labels.caseNumber')}</TableHead>
                    <TableHead>{t('common.labels.patient')}</TableHead>
                    <TableHead>{t('cases.list.columns.dentistClinic')}</TableHead>
                    <TableHead>{t('cases.list.columns.typeDetails')}</TableHead>
                    <TableHead>{t('common.labels.status')}</TableHead>
                    <TableHead>{t('common.labels.priority')}</TableHead>
                    <TableHead>{t('cases.list.columns.assignedTech')}</TableHead>
                    <TableHead>{t('common.labels.dueDate')}</TableHead>
                    <TableHead className="text-end">{t('common.labels.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cases.map((c) => {
                    const overdue = isOverdue(c.due_date, c.current_status);
                    const validTransitions = transitionsForRole(profile?.role, c.current_status);

                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-semibold whitespace-nowrap">
                          <Link
                            to={`/cases/${c.id}`}
                            className="text-brand-teal hover:text-brand-teal-hover hover:underline text-sm"
                          >
                            <CaseNumber value={c.case_number} />
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-slate-900"><AutoDir>{c.patient_name}</AutoDir></div>
                          {c.patient_age !== null && (
                            <div className="text-xs text-slate-500">
                              {t('common.labels.age', { value: c.patient_age })}
                            </div>
                          )}
                        </TableCell>
                        <TableCell><DentistClinic c={c} /></TableCell>
                        <TableCell><TypeDetails c={c} /></TableCell>
                        <TableCell>
                          <StatusBadge status={c.current_status} />
                        </TableCell>
                        <TableCell><PriorityPill priority={c.priority} /></TableCell>
                        <TableCell><TechnicianName c={c} /></TableCell>
                        <TableCell><DueDate c={c} overdue={overdue} /></TableCell>
                        <TableCell className="text-end">
                          <div className="flex items-center justify-end gap-1">
                            {/* One interactive element (a link styled as a button), not a button inside a link. */}
                            <Link
                              to={`/cases/${c.id}`}
                              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                              title={t('common.actions.viewDetails')}
                              aria-label={t('common.actions.viewDetails')}
                            >
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            </Link>

                            {canAssign && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openAssign(c)}
                                title={t('cases.list.assignTechnician')}
                                aria-label={t('cases.list.assignTechnician')}
                              >
                                <UserCheck className="h-3.5 w-3.5" />
                              </Button>
                            )}

                            {validTransitions.length > 0 && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => openStatus(c, validTransitions)}
                                title={t('cases.list.updateStatus')}
                              >
                                {t('cases.list.statusButton')}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </DesktopTable>
            </>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="p-4 border-t border-slate-100">
              <Pagination
                currentPage={filters.page || 1}
                totalPages={totalPages}
                onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assign Technician Dialog */}
      <Dialog
        open={!!assignModalCase}
        onOpenChange={(open) => !open && setAssignModalCase(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('cases.list.assignDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-600">
              {tx('cases.list.assignDialog.body', {
                caseNumber: <strong className="text-slate-900"><CaseNumber value={assignModalCase?.case_number} /></strong>,
                patient: assignModalCase?.patient_name,
                caseType: caseTypeLabel(assignModalCase?.case_type),
              })}
            </p>
            <Select
              label={t('cases.list.assignDialog.selectLabel')}
              value={selectedTechnicianId}
              onChange={(e) => setSelectedTechnicianId(e.target.value)}
              options={[{ value: '', label: t('common.select.chooseTechnician') }, ...technicianOptions]}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssignModalCase(null)}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              onClick={handleAssignSubmit}
              disabled={!selectedTechnicianId || submitting}
            >
              {submitting ? t('common.states.assigning') : t('cases.list.assignDialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Status Update Dialog */}
      <Dialog
        open={!!statusModalCase}
        onOpenChange={(open) => !open && setStatusModalCase(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('cases.list.statusDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-600">
              {tx('cases.list.statusDialog.body', {
                caseNumber: <strong className="text-slate-900"><CaseNumber value={statusModalCase?.case_number} /></strong>,
              })}
            </p>

            <Select
              label={t('cases.list.statusDialog.newStatus')}
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as CaseStatus)}
              options={(statusModalCase ? transitionsForRole(profile?.role, statusModalCase.current_status) : []).map(
                (s) => ({
                  value: s,
                  label: CASE_STATUS_LABELS[s],
                })
              )}
            />

            <Input
              label={t('cases.list.statusDialog.notesLabel')}
              placeholder={t('cases.list.statusDialog.notesPlaceholder')}
              value={statusNotes}
              onChange={(e) => setStatusNotes(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStatusModalCase(null)}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              onClick={handleStatusSubmit}
              disabled={!newStatus || submitting}
            >
              {submitting ? t('common.states.updating') : t('cases.list.statusDialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
