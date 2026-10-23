import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  useCase,
  useCaseEvents,
  useUpdateCaseStatus,
  useAssignTechnician,
  useCreateCaseEvent,
  useTechnicians,
} from '@/hooks/useSupabase';
import { Button, buttonVariants } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { AutoDir, CaseNumber } from '@/components/ui/Bidi';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
import {
  CASE_STATUS_LABELS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  EVENT_TYPE_LABELS,
  transitionsForRole,
  canAddCaseNote,
  caseTypeLabel,
  jawLabel,
  type CaseStatus,
} from '@/types/database';
import { LegacySpecsSection } from '@/components/CaseJawSpecs';
import { CaseAccountCard } from '@/components/money/CaseAccountCard';
import { formatDate, formatRelativeTime, isOverdue } from '@/lib/utils';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Clock,
  UserCheck,
  Activity,
  MessageSquare,
  ShieldAlert,
  Play,
  CheckCircle,
  Truck,
  Send,
  PauseCircle,
  RotateCcw,
  XCircle,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { tx } from '@/i18n/rich';
import { errorMessage } from '@/i18n/errors';
import { usePageTitle } from '@/hooks/usePageTitle';

export function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const { data: currentCase, isLoading: caseLoading } = useCase(id);
  const { data: events, isLoading: eventsLoading } = useCaseEvents(id);
  const { data: technicians } = useTechnicians();
  usePageTitle(currentCase?.case_number ?? t('layout.nav.cases'));

  // Mutations
  const updateStatus = useUpdateCaseStatus();
  const assignTechnician = useAssignTechnician();
  const createEvent = useCreateCaseEvent();

  // Dialog States
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedTechId, setSelectedTechId] = useState('');
  const [statusConfirmOpen, setStatusConfirmOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState<CaseStatus | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (caseLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!currentCase) {
    return (
      <div className="text-center py-16 space-y-4">
        <h2 className="text-xl font-bold text-slate-800">{t('cases.detail.notFound.title')}</h2>
        <p className="text-slate-500">{t('cases.detail.notFound.description')}</p>
        <Link to="/cases" className={buttonVariants({ variant: 'outline' })}>
          <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" aria-hidden="true" />
          {t('cases.detail.notFound.back')}
        </Link>
      </div>
    );
  }

  const validTransitions = transitionsForRole(profile?.role, currentCase.current_status);
  const overdue = isOverdue(currentCase.due_date, currentCase.current_status);
  const canAssign = profile?.role === 'owner' || profile?.role === 'receptionist';
  const canAddNote = canAddCaseNote(profile?.role);

  const handleStatusTransition = async () => {
    if (!targetStatus || !id) return;
    try {
      setSubmitting(true);
      await updateStatus.mutateAsync({
        caseId: id,
        newStatus: targetStatus,
        notes: statusNote || undefined,
      });
      toast.success(t('cases.detail.toasts.statusUpdated', { status: CASE_STATUS_LABELS[targetStatus] }));
      setStatusConfirmOpen(false);
      setTargetStatus(null);
      setStatusNote('');
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignSubmit = async () => {
    if (!id || !selectedTechId || !profile) return;
    try {
      setSubmitting(true);
      await assignTechnician.mutateAsync({
        caseId: id,
        technicianId: selectedTechId,
      });
      toast.success(t('cases.detail.toasts.assigned'));
      setAssignOpen(false);
      setSelectedTechId('');
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddNote = async () => {
    if (!id || !newNote.trim() || !profile) return;
    try {
      setSubmitting(true);
      await createEvent.mutateAsync({
        case_id: id,
        event_type: 'note_added',
        notes: newNote.trim(),
      });
      toast.success(t('cases.detail.toasts.noteAdded'));
      setNoteOpen(false);
      setNewNote('');
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const triggerStatusChange = (status: CaseStatus) => {
    setTargetStatus(status);
    setStatusNote('');
    setStatusConfirmOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Back button and Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            title={t('cases.detail.goBack')}
            aria-label={t('cases.detail.goBack')}
          >
            {/* "Back" points to the start edge: right in RTL. */}
            <ArrowLeft className="h-5 w-5 rtl:-scale-x-100" />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                <CaseNumber value={currentCase.case_number} />
              </h1>
              <StatusBadge status={currentCase.current_status} />
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                  PRIORITY_COLORS[currentCase.priority]
                }`}
              >
                {PRIORITY_LABELS[currentCase.priority]}
              </span>
              {overdue && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  {t('common.labels.overdue')}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500">
              {t('cases.detail.registeredOn', { date: formatDate(currentCase.created_at) })}
            </p>
          </div>
        </div>

        {/* Action button toolbar */}
        <div className="flex items-center gap-2">
          {canAddNote && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNoteOpen(true)}
            >
              <MessageSquare className="h-4 w-4 me-1" />
              {t('cases.detail.addNote')}
            </Button>
          )}
          {canAssign && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedTechId(currentCase.assigned_technician_id || '');
                setAssignOpen(true);
              }}
            >
              <UserCheck className="h-4 w-4 me-1" />
              {currentCase.assigned_technician_id ? t('cases.detail.reassignTech') : t('cases.detail.assignTech')}
            </Button>
          )}
        </div>
      </div>

      {/* Main Grid: Details & Workflow actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Details & Specifications (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Patient & Clinic Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-brand-teal" />
                {t('cases.detail.info.title')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-slate-500 block text-xs">{t('cases.detail.info.patientName')}</span>
                  <span className="font-semibold text-slate-900 text-base">
                    <AutoDir>{currentCase.patient_name}</AutoDir>
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs">{t('cases.detail.info.patientAge')}</span>
                  <span className="font-medium text-slate-800">
                    {currentCase.patient_age !== null ? t('cases.detail.info.years', { age: currentCase.patient_age }) : '—'}
                    {currentCase.patient_dob && ` (${formatDate(currentCase.patient_dob)})`}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs">{t('cases.detail.info.dentist')}</span>
                  <span className="font-medium text-slate-800">
                    <AutoDir>{currentCase.dentist?.name || currentCase.dentist_name_text || '—'}</AutoDir>
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs">{t('cases.detail.info.clinic')}</span>
                  <span className="font-medium text-slate-800">
                    <AutoDir>{currentCase.dentist?.clinic_name || currentCase.clinic_name_text || '—'}</AutoDir>
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs">{t('cases.detail.info.assignedTechnician')}</span>
                  <span className="font-medium text-slate-800">
                    {currentCase.assigned_technician?.full_name ? (
                      <AutoDir>{currentCase.assigned_technician.full_name}</AutoDir>
                    ) : (
                      <span className="text-slate-500">{t('cases.detail.info.noneAssigned')}</span>
                    )}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-xs">{t('cases.detail.info.targetDueDate')}</span>
                  <span className={`font-medium ${overdue ? 'text-red-600 font-bold' : 'text-slate-800'}`}>
                    {currentCase.due_date ? formatDate(currentCase.due_date) : t('cases.detail.info.noDueDate')}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Dental Specifications */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-indigo-600" />
                {t('cases.detail.specs.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-xs text-slate-500 block font-medium">{t('cases.detail.specs.caseType')}</span>
                  <span className="text-base font-semibold text-slate-900">
                    {caseTypeLabel(currentCase.case_type)}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-xs text-slate-500 block font-medium">{t('cases.detail.specs.jaw')}</span>
                  <span className="text-base font-semibold text-slate-900">
                    {jawLabel(currentCase.upper_jaw, currentCase.lower_jaw) ?? t('cases.detail.specs.notSpecified')}
                  </span>
                </div>
              </div>

              <LegacySpecsSection value={currentCase} />

              {currentCase.description && (
                <div>
                  <span className="text-xs font-semibold text-slate-700 block mb-1">
                    {t('cases.detail.specs.description')}
                  </span>
                  <div className="p-3 bg-slate-50 rounded text-slate-700 whitespace-pre-wrap" dir="auto">
                    {currentCase.description}
                  </div>
                </div>
              )}

              {currentCase.special_instructions && (
                <div>
                  <span className="text-xs font-semibold text-amber-700 block mb-1">
                    {t('cases.detail.specs.specialInstructions')}
                  </span>
                  <div className="p-3 bg-amber-50/60 border border-amber-200/60 rounded text-amber-900 whitespace-pre-wrap" dir="auto">
                    {currentCase.special_instructions}
                  </div>
                </div>
              )}

              {currentCase.notes && (
                <div>
                  <span className="text-xs font-semibold text-slate-700 block mb-1">
                    {t('cases.detail.specs.registrationNotes')}
                  </span>
                  <div className="p-3 bg-slate-50 rounded text-slate-700 whitespace-pre-wrap" dir="auto">
                    {currentCase.notes}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Status Transition Actions & Timeline (1 col) */}
        <div className="space-y-6">
          {/* Price and payments (owner + receptionist only; renders nothing for others) */}
          <CaseAccountCard caseData={currentCase} />

          {/* Workflow Action Panel */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('cases.detail.actions.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {validTransitions.length === 0 ? (
                <div className="p-3 bg-slate-50 rounded text-xs text-slate-500 text-center">
                  {t('cases.detail.actions.final', { status: CASE_STATUS_LABELS[currentCase.current_status] })}
                </div>
              ) : (
                <>
                  <p className="text-xs text-slate-500">
                    {tx('cases.detail.actions.available', {
                      status: <strong>{CASE_STATUS_LABELS[currentCase.current_status]}</strong>,
                    })}
                  </p>
                  <div className="flex flex-col gap-2">
                    {validTransitions.map((nextStatus) => {
                      let icon = <CheckCircle className="h-4 w-4 me-1.5" />;
                      let variant: 'default' | 'secondary' | 'outline' | 'destructive' = 'default';

                      if (nextStatus === 'in_progress') {
                        icon = <Play className="h-4 w-4 me-1.5" />;
                      } else if (nextStatus === 'awaiting_reception_receipt' || nextStatus === 'received_by_reception') {
                        icon = <Send className="h-4 w-4 me-1.5 rtl:-scale-x-100" />;
                        variant = 'secondary';
                      } else if (nextStatus === 'with_representative' || nextStatus === 'delivered') {
                        icon = <Truck className="h-4 w-4 me-1.5 rtl:-scale-x-100" />;
                      } else if (nextStatus === 'on_hold') {
                        icon = <PauseCircle className="h-4 w-4 me-1.5" />;
                        variant = 'outline';
                      } else if (nextStatus === 'rework_required') {
                        icon = <RotateCcw className="h-4 w-4 me-1.5" />;
                        variant = 'destructive';
                      } else if (nextStatus === 'cancelled') {
                        icon = <XCircle className="h-4 w-4 me-1.5" />;
                        variant = 'destructive';
                      }

                      return (
                        <Button
                          key={nextStatus}
                          variant={variant}
                          className="w-full justify-start text-xs sm:text-sm"
                          onClick={() => triggerStatusChange(nextStatus)}
                        >
                          {icon}
                          {t('cases.detail.actions.markAs', { status: CASE_STATUS_LABELS[nextStatus] })}
                        </Button>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Timeline of Case Events */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-500" />
                {t('cases.detail.timeline.title')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {eventsLoading ? (
                <div className="py-6 flex justify-center">
                  <Spinner size="sm" />
                </div>
              ) : !events || events.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">{t('cases.detail.timeline.empty')}</p>
              ) : (
                <ol className="relative ps-6 space-y-6 before:absolute before:start-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                  {events.map((evt) => (
                    <li key={evt.id} className="relative text-xs">
                      {/* Bullet icon */}
                      <div className="absolute -start-6 top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-brand-teal shadow-sm" />

                      <div className="font-semibold text-slate-800">
                        {EVENT_TYPE_LABELS[evt.event_type] || evt.event_type}
                      </div>

                      <div className="text-slate-500 text-[11px] flex flex-wrap items-center gap-1 mt-0.5">
                        <Calendar className="h-3 w-3" />
                        <span>{formatRelativeTime(evt.created_at)}</span>
                        {evt.actor && <span>• <AutoDir>{evt.actor.full_name}</AutoDir></span>}
                      </div>

                      {evt.previous_status && evt.new_status && (
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
                          <span className="font-medium text-slate-700">
                            {CASE_STATUS_LABELS[evt.previous_status]}
                          </span>
                          {/* Flow arrow follows reading direction: points left in RTL. */}
                          <ArrowRight className="h-3 w-3 rtl:-scale-x-100" aria-hidden="true" />
                          <span className="font-medium text-brand-teal">
                            {CASE_STATUS_LABELS[evt.new_status]}
                          </span>
                        </div>
                      )}

                      {evt.notes && (
                        <div className="mt-1 p-2 bg-slate-50 border border-slate-100 rounded text-slate-700 text-xs" dir="auto">
                          {evt.notes}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Confirm Status Transition Dialog */}
      <Dialog
        open={statusConfirmOpen}
        onOpenChange={(open) => !open && setStatusConfirmOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('cases.detail.statusDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-600">
              {tx('cases.detail.statusDialog.body', {
                caseNumber: <strong className="text-slate-900"><CaseNumber value={currentCase.case_number} /></strong>,
                status: <strong className="text-brand-teal">{targetStatus ? CASE_STATUS_LABELS[targetStatus] : ''}</strong>,
              })}
            </p>

            <Textarea
              label={t('cases.detail.statusDialog.notesLabel')}
              placeholder={t('cases.detail.statusDialog.notesPlaceholder')}
              rows={3}
              value={statusNote}
              onChange={(e) => setStatusNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStatusConfirmOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button onClick={handleStatusTransition} disabled={submitting}>
              {submitting ? t('common.states.updating') : t('common.actions.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Technician Dialog */}
      <Dialog
        open={assignOpen}
        onOpenChange={(open) => !open && setAssignOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('cases.detail.assignDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-600">
              {tx('cases.detail.assignDialog.body', {
                caseNumber: <strong className="text-slate-900"><CaseNumber value={currentCase.case_number} /></strong>,
              })}
            </p>
            <Select
              label={t('cases.detail.assignDialog.selectLabel')}
              value={selectedTechId}
              onChange={(e) => setSelectedTechId(e.target.value)}
              options={[
                { value: '', label: t('common.select.chooseTechnician') },
                ...(technicians || []).map((tech) => ({
                  value: tech.id,
                  label: t('cases.list.technicianOption', { name: tech.full_name, email: tech.email }),
                })),
              ]}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssignOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              onClick={handleAssignSubmit}
              disabled={!selectedTechId || submitting}
            >
              {submitting ? t('common.states.assigning') : t('cases.detail.assignDialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Note Dialog */}
      <Dialog
        open={noteOpen}
        onOpenChange={(open) => !open && setNoteOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('cases.detail.noteDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Textarea
              aria-label={t('cases.detail.noteDialog.title')}
              placeholder={t('cases.detail.noteDialog.placeholder')}
              rows={4}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNoteOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button onClick={handleAddNote} disabled={!newNote.trim() || submitting}>
              {submitting ? t('common.states.saving') : t('cases.detail.noteDialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
