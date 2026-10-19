import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  useAllDentists,
  useCreateDentist,
  useUpdateDentist,
} from '@/hooks/useSupabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { AutoDir, Ltr } from '@/components/ui/Bidi';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import type { Dentist } from '@/types/database';
import { formatDate } from '@/lib/utils';
import { Plus, Search, Edit2, Phone, Mail, MapPin, Stethoscope } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { usePageTitle } from '@/hooks/usePageTitle';

export function DentistsPage() {
  usePageTitle(t('dentists.title'));
  const { profile } = useAuth();
  const { data: dentists, isLoading, refetch } = useAllDentists();
  const createDentist = useCreateDentist();
  const updateDentist = useUpdateDentist();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDentist, setEditingDentist] = useState<Dentist | null>(null);
  const [name, setName] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canManage = profile?.role === 'owner' || profile?.role === 'receptionist';

  const openCreateModal = () => {
    setEditingDentist(null);
    setName('');
    setClinicName('');
    setPhone('');
    setEmail('');
    setAddress('');
    setNotes('');
    setModalOpen(true);
  };

  const openEditModal = (d: Dentist) => {
    setEditingDentist(d);
    setName(d.name);
    setClinicName(d.clinic_name || '');
    setPhone(d.phone || '');
    setEmail(d.email || '');
    setAddress(d.address || '');
    setNotes(d.notes || '');
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t('dentists.toasts.nameRequired'));
      return;
    }

    try {
      setSubmitting(true);
      if (editingDentist) {
        await updateDentist.mutateAsync({
          id: editingDentist.id,
          name: name.trim(),
          clinic_name: clinicName.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
        });
        toast.success(t('dentists.toasts.updated'));
      } else {
        await createDentist.mutateAsync({
          name: name.trim(),
          clinic_name: clinicName.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
          is_active: true,
          created_by: profile?.id,
        });
        toast.success(t('dentists.toasts.created'));
      }
      setModalOpen(false);
      refetch();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (d: Dentist) => {
    try {
      await updateDentist.mutateAsync({
        id: d.id,
        is_active: !d.is_active,
      });
      toast.success(
        !d.is_active
          ? t('dentists.toasts.activated', { name: d.name })
          : t('dentists.toasts.deactivated', { name: d.name })
      );
      refetch();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    }
  };

  const filteredDentists = (dentists || []).filter((d) => {
    const matchesSearch =
      d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (d.clinic_name && d.clinic_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (d.phone && d.phone.includes(searchTerm));

    if (filterActive === 'active') return matchesSearch && d.is_active;
    if (filterActive === 'inactive') return matchesSearch && !d.is_active;
    return matchesSearch;
  });

  const filterButtonClass = (value: typeof filterActive) =>
    `px-3 py-1 text-xs rounded font-medium transition ${
      filterActive === value ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
    }`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('dentists.title')}</h1>
          <p className="text-sm text-slate-500">{t('dentists.subtitle')}</p>
        </div>
        {canManage && (
          <Button onClick={openCreateModal} size="sm">
            <Plus className="h-4 w-4 me-1" />
            {t('dentists.add')}
          </Button>
        )}
      </div>

      {/* Filter toolbar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative flex-1 w-full sm:max-w-md">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
              <Input
                placeholder={t('dentists.searchPlaceholder')}
                aria-label={t('dentists.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ps-9"
              />
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <span className="text-xs text-slate-500 font-medium">{t('common.labels.filter')}</span>
              <div className="flex rounded-md border border-slate-200 p-0.5 bg-slate-50">
                <button type="button" onClick={() => setFilterActive('all')} className={filterButtonClass('all')}>
                  {t('common.labels.all')}
                </button>
                <button type="button" onClick={() => setFilterActive('active')} className={filterButtonClass('active')}>
                  {t('common.labels.active')}
                </button>
                <button type="button" onClick={() => setFilterActive('inactive')} className={filterButtonClass('inactive')}>
                  {t('common.labels.inactive')}
                </button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : filteredDentists.length === 0 ? (
            <EmptyState
              title={t('dentists.empty.title')}
              description={t('dentists.empty.description')}
              actionLabel={canManage ? t('dentists.empty.action') : undefined}
              onAction={canManage ? openCreateModal : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('dentists.columns.name')}</TableHead>
                    <TableHead>{t('dentists.columns.clinic')}</TableHead>
                    <TableHead>{t('dentists.columns.contact')}</TableHead>
                    <TableHead>{t('common.labels.address')}</TableHead>
                    <TableHead>{t('common.labels.status')}</TableHead>
                    <TableHead>{t('dentists.columns.addedOn')}</TableHead>
                    <TableHead className="text-end">{t('common.labels.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDentists.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-semibold text-slate-900">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-teal-50 text-brand-teal">
                            <Stethoscope className="h-4 w-4" />
                          </div>
                          <AutoDir>{d.name}</AutoDir>
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-700 font-medium">
                        <AutoDir>{d.clinic_name || '—'}</AutoDir>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1 text-xs text-slate-600">
                          {d.phone && (
                            <div className="flex items-center gap-1.5">
                              <Phone className="h-3 w-3 text-slate-500" />
                              <Ltr>{d.phone}</Ltr>
                            </div>
                          )}
                          {d.email && (
                            <div className="flex items-center gap-1.5">
                              <Mail className="h-3 w-3 text-slate-500" />
                              <Ltr>{d.email}</Ltr>
                            </div>
                          )}
                          {!d.phone && !d.email && <span className="text-slate-500">—</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 max-w-xs truncate">
                        {d.address ? (
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-3 w-3 text-slate-500 shrink-0" />
                            <AutoDir className="truncate">{d.address}</AutoDir>
                          </div>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={d.is_active ? 'success' : 'secondary'}>
                          {d.is_active ? t('common.labels.active') : t('common.labels.inactive')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                        {formatDate(d.created_at)}
                      </TableCell>
                      <TableCell className="text-end">
                        {canManage && (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditModal(d)}
                              title={t('dentists.editDetails')}
                              aria-label={t('dentists.editDetails')}
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleToggleStatus(d)}
                              className="text-xs"
                            >
                              {d.is_active ? t('common.actions.deactivate') : t('common.actions.activate')}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingDentist ? t('dentists.dialog.editTitle') : t('dentists.dialog.createTitle')}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <Input
              label={t('dentists.dialog.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('dentists.dialog.namePlaceholder')}
              required
            />

            <Input
              label={t('dentists.dialog.clinic')}
              value={clinicName}
              onChange={(e) => setClinicName(e.target.value)}
              placeholder={t('dentists.dialog.clinicPlaceholder')}
            />

            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('common.labels.phone')}
                type="tel"
                dir="ltr"
                className="text-end"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('dentists.dialog.phonePlaceholder')}
              />

              <Input
                label={t('common.labels.email')}
                type="email"
                dir="ltr"
                className="text-end"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('dentists.dialog.emailPlaceholder')}
              />
            </div>

            <Input
              label={t('dentists.dialog.address')}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t('dentists.dialog.addressPlaceholder')}
            />

            <Textarea
              label={t('dentists.dialog.notes')}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('dentists.dialog.notesPlaceholder')}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setModalOpen(false)}
              >
                {t('common.actions.cancel')}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting
                  ? t('common.states.saving')
                  : editingDentist
                  ? t('dentists.dialog.update')
                  : t('dentists.dialog.register')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
