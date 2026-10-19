import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useCreateCase } from '@/hooks/useSupabase';
import { useDentists, useCreateDentist, useTechnicians, useWorkTypes } from '@/hooks/useSupabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import { SHADE_OPTIONS, PRIORITY_LABELS, shadeLabel } from '@/types/database';
import type { CasePriority } from '@/types/database';
import { ArrowLeft, Plus, Info } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { usePageTitle } from '@/hooks/usePageTitle';

const PRIORITIES: CasePriority[] = ['low', 'normal', 'high', 'urgent'];

export function CaseRegistrationPage() {
  usePageTitle(t('cases.register.title'));
  const navigate = useNavigate();
  const { profile } = useAuth();
  const createCase = useCreateCase();
  const { data: dentists } = useDentists();
  const { data: technicians } = useTechnicians();
  const { data: workTypes, isLoading: workTypesLoading } = useWorkTypes();
  const noWorkTypes = !workTypesLoading && (workTypes ?? []).length === 0;
  const createDentist = useCreateDentist();

  const [submitting, setSubmitting] = useState(false);
  const [showNewDentist, setShowNewDentist] = useState(false);
  const [newDentistName, setNewDentistName] = useState('');
  const [newDentistClinic, setNewDentistClinic] = useState('');
  const [newDentistPhone, setNewDentistPhone] = useState('');

  // Form state
  const [patientName, setPatientName] = useState('');
  const [patientAge, setPatientAge] = useState('');
  const [dentistId, setDentistId] = useState('');
  const [dentistNameText, setDentistNameText] = useState('');
  const [caseType, setCaseType] = useState('');
  const [toothNumber, setToothNumber] = useState('');
  const [shade, setShade] = useState('');
  const [description, setDescription] = useState('');
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [priority, setPriority] = useState<CasePriority>('normal');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [assignTechnicianId, setAssignTechnicianId] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!patientName.trim()) newErrors.patientName = t('cases.register.validation.patientRequired');
    if (patientName.length > 300) newErrors.patientName = t('cases.register.validation.patientTooLong');
    if (!caseType) newErrors.caseType = t('cases.register.validation.caseTypeRequired');
    if (!dentistId && !dentistNameText.trim()) {
      newErrors.dentist = t('cases.register.validation.dentistRequired');
    }
    if (patientAge && (isNaN(Number(patientAge)) || Number(patientAge) < 0 || Number(patientAge) > 150)) {
      newErrors.patientAge = t('cases.register.validation.invalidAge');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);

    try {
      // case_number, current_status, registered_by and assigned_at are set by the database
      const caseData: Record<string, unknown> = {
        patient_name: patientName.trim(),
        case_type: caseType,
        priority,
      };

      if (patientAge) caseData.patient_age = Number(patientAge);
      if (dentistId) caseData.dentist_id = dentistId;
      if (dentistNameText.trim()) caseData.dentist_name_text = dentistNameText.trim();
      if (toothNumber.trim()) caseData.tooth_number = toothNumber.trim();
      if (shade) caseData.shade = shade;
      if (description.trim()) caseData.description = description.trim();
      if (specialInstructions.trim()) caseData.special_instructions = specialInstructions.trim();
      if (dueDate) caseData.due_date = dueDate;
      if (notes.trim()) caseData.notes = notes.trim();
      if (assignTechnicianId) caseData.assigned_technician_id = assignTechnicianId;

      const newCase = await createCase.mutateAsync(caseData);
      toast.success(t('cases.register.toasts.registered', { caseNumber: newCase.case_number }));
      navigate(`/cases/${newCase.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddDentist = async () => {
    if (!newDentistName.trim()) return;

    try {
      const dentist = await createDentist.mutateAsync({
        name: newDentistName.trim(),
        clinic_name: newDentistClinic.trim() || null,
        phone: newDentistPhone.trim() || null,
        created_by: profile?.id,
      });
      setDentistId(dentist.id);
      setShowNewDentist(false);
      setNewDentistName('');
      setNewDentistClinic('');
      setNewDentistPhone('');
      toast.success(t('cases.register.toasts.dentistAdded'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          title={t('common.actions.back')}
          aria-label={t('common.actions.back')}
        >
          <ArrowLeft className="h-5 w-5 rtl:-scale-x-100" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{t('cases.register.title')}</h1>
          <p className="text-[var(--muted-foreground)]">{t('cases.register.subtitle')}</p>
        </div>
      </div>

      {noWorkTypes && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <Info className="h-5 w-5 shrink-0 text-amber-600" />
          {profile?.role === 'owner' ? (
            <div className="space-y-2">
              <p>{t('workTypes.registration.emptyOwner')}</p>
              <Link to="/work-types" className="font-semibold text-brand-teal hover:underline">
                {t('workTypes.registration.emptyOwnerLink')}
              </Link>
            </div>
          ) : (
            <p>{t('workTypes.registration.emptyStaff')}</p>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          {/* Patient Information */}
          <Card>
            <CardHeader>
              <CardTitle>{t('cases.register.patient.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label={t('cases.register.patient.name')}
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  error={errors.patientName}
                  placeholder={t('cases.register.patient.namePlaceholder')}
                  maxLength={300}
                />
                <Input
                  label={t('cases.register.patient.age')}
                  type="number"
                  value={patientAge}
                  onChange={(e) => setPatientAge(e.target.value)}
                  error={errors.patientAge}
                  placeholder={t('cases.register.patient.agePlaceholder')}
                  min={0}
                  max={150}
                />
              </div>
            </CardContent>
          </Card>

          {/* Dentist / Clinic */}
          <Card>
            <CardHeader>
              <CardTitle>{t('cases.register.dentist.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <Select
                    label={t('cases.register.dentist.select')}
                    value={dentistId}
                    onChange={(e) => setDentistId(e.target.value)}
                  >
                    <option value="">{t('common.select.placeholder')}</option>
                    {dentists?.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.clinic_name
                          ? t('cases.register.dentist.option', { name: d.name, clinic: d.clinic_name })
                          : d.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowNewDentist(!showNewDentist)}
                >
                  <Plus className="h-4 w-4" />
                  {t('cases.register.dentist.new')}
                </Button>
              </div>

              {showNewDentist && (
                <div className="p-4 border rounded-md bg-slate-50 space-y-3">
                  <Input
                    label={t('cases.register.dentist.newName')}
                    value={newDentistName}
                    onChange={(e) => setNewDentistName(e.target.value)}
                    placeholder={t('cases.register.dentist.newNamePlaceholder')}
                  />
                  <Input
                    label={t('cases.register.dentist.newClinic')}
                    value={newDentistClinic}
                    onChange={(e) => setNewDentistClinic(e.target.value)}
                    placeholder={t('cases.register.dentist.newClinicPlaceholder')}
                  />
                  <Input
                    label={t('cases.register.dentist.newPhone')}
                    type="tel"
                    dir="ltr"
                    className="text-end"
                    value={newDentistPhone}
                    onChange={(e) => setNewDentistPhone(e.target.value)}
                    placeholder={t('cases.register.dentist.newPhonePlaceholder')}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleAddDentist}
                    loading={createDentist.isPending}
                  >
                    {t('cases.register.dentist.addDentist')}
                  </Button>
                </div>
              )}

              {!dentistId && (
                <Input
                  label={t('cases.register.dentist.manual')}
                  value={dentistNameText}
                  onChange={(e) => setDentistNameText(e.target.value)}
                  error={errors.dentist}
                  placeholder={t('cases.register.dentist.manualPlaceholder')}
                />
              )}
            </CardContent>
          </Card>

          {/* Case Details */}
          <Card>
            <CardHeader>
              <CardTitle>{t('cases.register.details.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Select
                  label={t('cases.register.details.caseType')}
                  value={caseType}
                  onChange={(e) => setCaseType(e.target.value)}
                  error={errors.caseType}
                >
                  <option value="">{t('cases.register.details.selectType')}</option>
                  {(workTypes ?? []).map((type) => (
                    <option key={type.id} value={type.name}>{type.name}</option>
                  ))}
                </Select>

                <Input
                  label={t('cases.register.details.toothNumber')}
                  value={toothNumber}
                  onChange={(e) => setToothNumber(e.target.value)}
                  placeholder={t('cases.register.details.toothPlaceholder')}
                  dir="ltr"
                  className="text-end"
                />

                <Select
                  label={t('cases.register.details.shade')}
                  value={shade}
                  onChange={(e) => setShade(e.target.value)}
                >
                  <option value="">{t('cases.register.details.selectShade')}</option>
                  {SHADE_OPTIONS.map((s) => (
                    <option key={s} value={s}>{shadeLabel(s)}</option>
                  ))}
                </Select>

                <Select
                  label={t('cases.register.details.priority')}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as CasePriority)}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                  ))}
                </Select>

                <Input
                  label={t('cases.register.details.dueDate')}
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>

              <Textarea
                label={t('cases.register.details.description')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('cases.register.details.descriptionPlaceholder')}
              />

              <Textarea
                label={t('cases.register.details.specialInstructions')}
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
                placeholder={t('cases.register.details.specialInstructionsPlaceholder')}
              />
            </CardContent>
          </Card>

          {/* Assignment */}
          <Card>
            <CardHeader>
              <CardTitle>{t('cases.register.assignment.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                label={t('cases.register.assignment.label')}
                value={assignTechnicianId}
                onChange={(e) => setAssignTechnicianId(e.target.value)}
              >
                <option value="">{t('cases.register.assignment.later')}</option>
                {technicians?.map((tech) => (
                  <option key={tech.id} value={tech.id}>{tech.full_name}</option>
                ))}
              </Select>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle>{t('cases.register.notes.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                aria-label={t('cases.register.notes.title')}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('cases.register.notes.placeholder')}
              />
            </CardContent>
            <CardFooter className="justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                {t('common.actions.cancel')}
              </Button>
              <Button type="submit" loading={submitting} disabled={noWorkTypes}>
                {t('cases.register.submit')}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </form>
    </div>
  );
}
