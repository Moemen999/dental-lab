import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  useProfiles,
  useUpdateProfile,
  useTechnicians,
  useCreateEmployee,
  useGetOutstandingWork,
  useReassignAndDeactivateTechnician,
  useResetUserPassword,
} from '@/hooks/useSupabase';
import { Button } from '@/components/ui/Button';
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
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { AutoDir, CaseNumber, Ltr } from '@/components/ui/Bidi';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/Dialog';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import {
  ROLE_LABELS,
  ACCOUNT_STATUS_LABELS,
  type Profile,
  type AppRole,
  type AccountStatus,
} from '@/types/database';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cn, formatDate } from '@/lib/utils';
import {
  Search,
  UserCog,
  Phone,
  UserPlus,
  AlertTriangle,
  KeyRound,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { tx } from '@/i18n/rich';
import { errorMessage } from '@/i18n/errors';
import { usePageTitle } from '@/hooks/usePageTitle';

function roleBadgeVariant(role: AppRole): 'default' | 'secondary' | 'outline' {
  if (role === 'technician') return 'secondary';
  if (role === 'receptionist') return 'outline';
  return 'default';
}

function AccountStatusBadge({ status }: { status: AccountStatus }) {
  if (status === 'active') return <Badge variant="success">{ACCOUNT_STATUS_LABELS.active}</Badge>;
  if (status === 'inactive') return <Badge variant="destructive">{ACCOUNT_STATUS_LABELS.inactive}</Badge>;
  return <Badge variant="secondary">{ACCOUNT_STATUS_LABELS.pending_invitation}</Badge>;
}

function PhoneLine({ u }: { u: Profile }) {
  return u.phone ? (
    <div className="flex items-center gap-1 text-xs text-slate-600">
      <Phone className="h-3 w-3 shrink-0 text-slate-500" aria-hidden="true" />
      <Ltr className="whitespace-nowrap">{u.phone}</Ltr>
    </div>
  ) : (
    <span className="text-xs text-slate-500">—</span>
  );
}

export function EmployeesPage() {
  usePageTitle(t('employees.title'));
  const { profile: currentProfile } = useAuth();
  const { data: profiles, isLoading, refetch } = useProfiles();
  const { data: activeTechnicians } = useTechnicians();

  const updateProfile = useUpdateProfile();
  const createEmployee = useCreateEmployee();
  const reassignAndDeactivate = useReassignAndDeactivateTechnician();
  const resetPassword = useResetUserPassword();

  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Role / Status Edit Dialog
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [newRole, setNewRole] = useState<AppRole>('technician');
  const [newStatus, setNewStatus] = useState<AccountStatus>('active');
  const [submittingEdit, setSubmittingEdit] = useState(false);

  // New Employee Invite Dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('technician');
  const [invitePhone, setInvitePhone] = useState('');
  const [submittingInvite, setSubmittingInvite] = useState(false);

  // Deactivation with Outstanding Work Dialog
  const [deactivateTarget, setDeactivateTarget] = useState<Profile | null>(null);
  const [reassignToTechId, setReassignToTechId] = useState<string>('');
  const [deactivationReason, setDeactivationReason] = useState<string>('');
  const [submittingDeactivation, setSubmittingDeactivation] = useState(false);

  // Query outstanding work for the user being deactivated
  const { data: outstandingWork, isLoading: loadingWork } = useGetOutstandingWork(
    deactivateTarget?.id
  );

  // Active owners count check
  const activeOwners = (profiles || []).filter(
    (p) => p.role === 'owner' && p.status === 'active'
  );

  const roleOptions = Object.entries(ROLE_LABELS).map(([val, label]) => ({ value: val, label }));

  const openEditDialog = (u: Profile) => {
    setSelectedUser(u);
    setNewRole(u.role);
    setNewStatus(u.status);
  };

  const handleUpdateUser = async () => {
    if (!selectedUser) return;

    // Check last active owner guard
    if (
      selectedUser.role === 'owner' &&
      (newRole !== 'owner' || newStatus !== 'active') &&
      activeOwners.length <= 1 &&
      activeOwners[0]?.id === selectedUser.id
    ) {
      toast.error(t('employees.toasts.lastOwner'));
      return;
    }

    try {
      setSubmittingEdit(true);
      await updateProfile.mutateAsync({
        id: selectedUser.id,
        role: newRole,
        status: newStatus,
        deactivated_at: newStatus === 'inactive' ? new Date().toISOString() : null,
      });
      toast.success(t('employees.toasts.updated'));
      setSelectedUser(null);
      refetch();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleOpenDeactivation = (u: Profile) => {
    if (u.id === currentProfile?.id) {
      toast.error(t('employees.toasts.selfDeactivate'));
      return;
    }

    if (u.role === 'owner' && activeOwners.length <= 1 && activeOwners[0]?.id === u.id) {
      toast.error(t('employees.toasts.lastOwnerDeactivate'));
      return;
    }

    setDeactivateTarget(u);
    setReassignToTechId('');
    setDeactivationReason(t('employees.deactivateDialog.defaultReason'));
  };

  const handleConfirmDeactivation = async () => {
    if (!deactivateTarget) return;

    try {
      setSubmittingDeactivation(true);

      const hasActiveCases = (outstandingWork?.active_case_count || 0) > 0;

      if (deactivateTarget.role === 'technician' && hasActiveCases) {
        if (!reassignToTechId) {
          toast.error(t('employees.toasts.selectReplacement'));
          setSubmittingDeactivation(false);
          return;
        }

        await reassignAndDeactivate.mutateAsync({
          technicianId: deactivateTarget.id,
          reassignToId: reassignToTechId,
          reason: deactivationReason || t('employees.deactivateDialog.defaultReassignReason'),
        });
        toast.success(
          t('employees.toasts.reassigned', { count: outstandingWork?.active_case_count ?? 0 })
        );
      } else {
        await updateProfile.mutateAsync({
          id: deactivateTarget.id,
          status: 'inactive',
          deactivated_at: new Date().toISOString(),
        });
        toast.success(t('employees.toasts.deactivated', { name: deactivateTarget.full_name }));
      }

      setDeactivateTarget(null);
      refetch();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setSubmittingDeactivation(false);
    }
  };

  const handleCreateEmployee = async () => {
    if (!inviteEmail.trim() || !inviteFullName.trim()) {
      toast.error(t('employees.toasts.requiredFields'));
      return;
    }

    try {
      setSubmittingInvite(true);
      await createEmployee.mutateAsync({
        email: inviteEmail.trim(),
        full_name: inviteFullName.trim(),
        role: inviteRole,
        phone: invitePhone.trim() || undefined,
      });

      toast.success(t('employees.toasts.created', { name: inviteFullName }));
      setInviteOpen(false);
      setInviteEmail('');
      setInviteFullName('');
      setInviteRole('technician');
      setInvitePhone('');
      refetch();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setSubmittingInvite(false);
    }
  };

  const handleResetPassword = async (u: Profile) => {
    try {
      await resetPassword.mutateAsync(u.email);
      toast.success(t('employees.toasts.resetSent', { email: u.email }));
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    }
  };

  const filteredUsers = (profiles || []).filter((u) => {
    const matchesSearch =
      u.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.phone && u.phone.includes(searchTerm));

    if (roleFilter && u.role !== roleFilter) return false;
    if (statusFilter && u.status !== statusFilter) return false;
    return matchesSearch;
  });

  // Same buttons in the phone card (labelled, 44px) and the table row (compact icons).
  const renderActions = (u: Profile, mobile: boolean) => {
    const isSelf = u.id === currentProfile?.id;
    const isLastOwner =
      u.role === 'owner' &&
      activeOwners.length <= 1 &&
      activeOwners[0]?.id === u.id;
    const size = mobile ? 'default' : 'sm';

    return (
      <>
        <Button
          variant={mobile ? 'outline' : 'ghost'}
          size={size}
          onClick={() => handleResetPassword(u)}
          title={mobile ? undefined : t('employees.resetPassword')}
          aria-label={mobile ? undefined : t('employees.resetPassword')}
        >
          <KeyRound className="h-4 w-4 text-slate-500" aria-hidden="true" />
          {mobile && t('employees.resetPassword')}
        </Button>

        <Button
          variant={mobile ? 'outline' : 'ghost'}
          size={size}
          onClick={() => openEditDialog(u)}
          title={mobile ? undefined : t('employees.editRoleStatus')}
          aria-label={mobile ? undefined : t('employees.editRoleStatus')}
        >
          <UserCog className="h-4 w-4" aria-hidden="true" />
          {mobile && t('employees.editRoleStatus')}
        </Button>

        {!isSelf && (
          <Button
            variant="outline"
            size={size}
            onClick={() => {
              if (u.status === 'active') {
                handleOpenDeactivation(u);
              } else {
                updateProfile.mutate({ id: u.id, status: 'active' });
                toast.success(t('employees.toasts.reactivated'));
              }
            }}
            disabled={isLastOwner}
            className={cn(
              !mobile && 'text-xs',
              u.status === 'active' && 'hover:bg-red-50 hover:text-red-700 hover:border-red-300',
            )}
          >
            {u.status === 'active' ? t('common.actions.deactivate') : t('common.actions.activate')}
          </Button>
        )}
      </>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 id="employees-title" className="text-2xl font-bold text-slate-900">{t('employees.title')}</h1>
          <p className="text-sm text-slate-500">{t('employees.subtitle')}</p>
        </div>

        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus className="h-4 w-4 me-2" />
          {t('employees.add')}
        </Button>
      </div>

      {/* Filter toolbar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative flex-1 w-full sm:max-w-md">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
              <Input
                placeholder={t('employees.searchPlaceholder')}
                aria-label={t('employees.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ps-9"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="w-40">
                <Select
                  aria-label={t('common.labels.role')}
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  options={[{ value: '', label: t('employees.allRoles') }, ...roleOptions]}
                />
              </div>

              <div className="w-40">
                <Select
                  aria-label={t('employees.columns.accountStatus')}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  options={[
                    { value: '', label: t('employees.allStatuses') },
                    { value: 'active', label: ACCOUNT_STATUS_LABELS.active },
                    { value: 'inactive', label: ACCOUNT_STATUS_LABELS.inactive },
                    { value: 'pending_invitation', label: ACCOUNT_STATUS_LABELS.pending_invitation },
                  ]}
                />
              </div>

              {(roleFilter || statusFilter || searchTerm) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchTerm('');
                    setRoleFilter('');
                    setStatusFilter('');
                  }}
                >
                  {t('common.actions.clearFilters')}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Staff Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <EmptyState
              title={t('employees.empty.title')}
              description={t('employees.empty.description')}
            />
          ) : (
            <>
            <MobileList aria-labelledby="employees-title">
              {filteredUsers.map((u) => (
                <MobileListItem key={u.id}>
                  <MobileItemHeader>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900"><AutoDir>{u.full_name}</AutoDir></div>
                      <div className="text-xs text-slate-500 break-all md:break-normal"><Ltr>{u.email}</Ltr></div>
                    </div>
                    <Badge variant={roleBadgeVariant(u.role)}>{ROLE_LABELS[u.role]}</Badge>
                  </MobileItemHeader>
                  <MobileFields>
                    <MobileField label={t('employees.columns.accountStatus')}><AccountStatusBadge status={u.status} /></MobileField>
                    <MobileField label={t('employees.columns.contact')}><PhoneLine u={u} /></MobileField>
                    <MobileField label={t('employees.columns.joined')} className="whitespace-nowrap text-xs text-slate-500">
                      {formatDate(u.created_at)}
                    </MobileField>
                  </MobileFields>
                  <MobileActions>{renderActions(u, true)}</MobileActions>
                </MobileListItem>
              ))}
            </MobileList>
            <DesktopTable>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('employees.columns.employee')}</TableHead>
                    <TableHead>{t('common.labels.role')}</TableHead>
                    <TableHead>{t('employees.columns.accountStatus')}</TableHead>
                    <TableHead>{t('employees.columns.contact')}</TableHead>
                    <TableHead>{t('employees.columns.joined')}</TableHead>
                    <TableHead className="text-end">{t('common.labels.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="font-semibold text-slate-900"><AutoDir>{u.full_name}</AutoDir></div>
                        <div className="text-xs text-slate-500"><Ltr>{u.email}</Ltr></div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={roleBadgeVariant(u.role)}>
                          {ROLE_LABELS[u.role]}
                        </Badge>
                      </TableCell>
                      <TableCell><AccountStatusBadge status={u.status} /></TableCell>
                      <TableCell><PhoneLine u={u} /></TableCell>
                      <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                        {formatDate(u.created_at)}
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex items-center justify-end gap-1">
                          {renderActions(u, false)}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DesktopTable>
            </>
          )}
        </CardContent>
      </Card>

      {/* Add Employee Dialog */}
      <Dialog open={inviteOpen} onOpenChange={(open) => !open && setInviteOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('employees.inviteDialog.title')}</DialogTitle>
            <DialogDescription>{t('employees.inviteDialog.description')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Input
              label={t('employees.inviteDialog.fullName')}
              placeholder={t('employees.inviteDialog.fullNamePlaceholder')}
              value={inviteFullName}
              onChange={(e) => setInviteFullName(e.target.value)}
            />

            <Input
              label={t('employees.inviteDialog.email')}
              type="email"
              dir="ltr"
              className="text-end"
              placeholder={t('employees.inviteDialog.emailPlaceholder')}
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />

            <Select
              label={t('employees.inviteDialog.role')}
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as AppRole)}
              options={roleOptions}
            />

            <Input
              label={t('employees.inviteDialog.phone')}
              type="tel"
              dir="ltr"
              className="text-end"
              placeholder={t('employees.inviteDialog.phonePlaceholder')}
              value={invitePhone}
              onChange={(e) => setInvitePhone(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button onClick={handleCreateEmployee} loading={submittingInvite}>
              {t('employees.inviteDialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role & Status Dialog */}
      <Dialog
        open={!!selectedUser}
        onOpenChange={(open) => !open && setSelectedUser(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('employees.editDialog.title')}</DialogTitle>
            <DialogDescription>
              {tx('employees.editDialog.description', { name: selectedUser?.full_name })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Select
              label={t('employees.editDialog.role')}
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as AppRole)}
              options={roleOptions}
            />

            <Select
              label={t('employees.editDialog.status')}
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as AccountStatus)}
              options={[
                { value: 'active', label: ACCOUNT_STATUS_LABELS.active },
                { value: 'inactive', label: t('employees.editDialog.inactiveLong') },
                { value: 'pending_invitation', label: ACCOUNT_STATUS_LABELS.pending_invitation },
              ]}
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelectedUser(null)}>
              {t('common.actions.cancel')}
            </Button>
            <Button onClick={handleUpdateUser} loading={submittingEdit}>
              {t('common.actions.saveChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inspect Outstanding Responsibilities & Reassign on Deactivation Dialog */}
      <Dialog
        open={!!deactivateTarget}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              {t('employees.deactivateDialog.title')}
            </DialogTitle>
            <DialogDescription>
              {tx('employees.deactivateDialog.description', {
                name: <strong>{deactivateTarget?.full_name}</strong>,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-sm">
            {loadingWork ? (
              <div className="flex justify-center py-6">
                <Spinner size="sm" />
              </div>
            ) : (
              <>
                {/* Active Cases Section */}
                {outstandingWork && outstandingWork.active_case_count > 0 ? (
                  <div className="space-y-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-center gap-2 text-amber-800 font-semibold">
                      <ShieldAlert className="h-4 w-4" />
                      <span>
                        {t('employees.deactivateDialog.outstanding', { count: outstandingWork.active_case_count })}
                      </span>
                    </div>
                    <p className="text-xs text-amber-700">
                      {t('employees.deactivateDialog.outstandingHelp')}
                    </p>

                    <div className="max-h-36 overflow-y-auto space-y-1 bg-white p-2 rounded border border-amber-200 text-xs">
                      {outstandingWork.active_cases.map((c) => (
                        <div
                          key={c.id}
                          className="flex flex-wrap justify-between items-center gap-x-2 gap-y-1 py-1 border-b last:border-b-0"
                        >
                          <CaseNumber value={c.case_number} className="font-medium" />
                          <AutoDir className="min-w-0 flex-1 break-words text-slate-600">{c.patient_name}</AutoDir>
                          <StatusBadge status={c.current_status} />
                        </div>
                      ))}
                    </div>

                    <Select
                      label={t('employees.deactivateDialog.reassignTo')}
                      value={reassignToTechId}
                      onChange={(e) => setReassignToTechId(e.target.value)}
                      options={[
                        { value: '', label: t('employees.deactivateDialog.selectReplacement') },
                        ...(activeTechnicians || [])
                          .filter((tech) => tech.id !== deactivateTarget?.id)
                          .map((tech) => ({
                            value: tech.id,
                            label: t('cases.list.technicianOption', { name: tech.full_name, email: tech.email }),
                          })),
                      ]}
                    />
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50 border rounded text-xs text-slate-600">
                    {t('employees.deactivateDialog.noWork')}
                  </div>
                )}

                <Input
                  label={t('employees.deactivateDialog.reason')}
                  placeholder={t('employees.deactivateDialog.reasonPlaceholder')}
                  value={deactivationReason}
                  onChange={(e) => setDeactivationReason(e.target.value)}
                />
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeactivateTarget(null)}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDeactivation}
              loading={submittingDeactivation}
              disabled={
                loadingWork ||
                ((outstandingWork?.active_case_count || 0) > 0 &&
                  deactivateTarget?.role === 'technician' &&
                  !reassignToTechId)
              }
            >
              {t('employees.deactivateDialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
