import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { t } from '@/i18n';
import type { Case, CaseStatus, Profile, Dentist, DeliveryBatch, CaseEvent, AuditLog, CasePriority, WorkType } from '@/types/database';

// ---- Profile Hooks ----

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name');
      if (error) throw error;
      return data as Profile[];
    },
  });
}

export function useTechnicians() {
  return useQuery({
    queryKey: ['profiles', 'technicians'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'technician')
        .eq('status', 'active')
        .order('full_name');
      if (error) throw error;
      return data as Profile[];
    },
  });
}

export function useRepresentatives() {
  return useQuery({
    queryKey: ['profiles', 'representatives'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'representative')
        .eq('status', 'active')
        .order('full_name');
      if (error) throw error;
      return data as Profile[];
    },
  });
}

export function useReceptionists() {
  return useQuery({
    queryKey: ['profiles', 'receptionists'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'receptionist')
        .eq('status', 'active')
        .order('full_name');
      if (error) throw error;
      return data as Profile[];
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Profile> & { id: string }) => {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as Profile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
}

export function useGetOutstandingWork(userId: string | undefined) {
  return useQuery({
    queryKey: ['employee-outstanding-work', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase.rpc('get_employee_outstanding_work', {
        p_user_id: userId,
      });
      if (error) {
        // Fallback query if RPC isn't deployed yet
        const { data: activeCases } = await supabase
          .from('cases')
          .select('id, case_number, patient_name, case_type, current_status, due_date')
          .eq('assigned_technician_id', userId)
          .not('current_status', 'in', '("delivered","cancelled")');

        return {
          user_id: userId,
          active_case_count: activeCases?.length || 0,
          active_cases: activeCases || [],
          open_batch_count: 0,
          open_batches: [],
        };
      }
      return data as {
        user_id: string;
        role: string;
        active_case_count: number;
        active_cases: Array<{
          id: string;
          case_number: string;
          patient_name: string;
          case_type: string;
          current_status: CaseStatus;
          due_date: string | null;
        }>;
        open_batch_count: number;
        open_batches: Array<{
          id: string;
          batch_reference: string;
          batch_type: string;
          status: string;
          handoff_at: string;
        }>;
      };
    },
    enabled: !!userId,
  });
}

export function useReassignAndDeactivateTechnician() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      technicianId,
      reassignToId,
      reason,
    }: {
      technicianId: string;
      reassignToId: string | null;
      reason?: string;
    }) => {
      const { data, error } = await supabase.rpc('reassign_and_deactivate_technician', {
        p_technician_id: technicianId,
        p_reassign_to_id: reassignToId,
        p_reason: reason || t('employees.deactivateDialog.defaultReassignReason'),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (employeeData: {
      email: string;
      full_name: string;
      role: string;
      phone?: string;
    }) => {
      // The Edge Function creates the account with a random server-side password
      // and emails the employee a link to set their own. No password is sent from
      // the browser. (Profiles cannot be inserted directly: RLS denies it.)
      const { data, error } = await supabase.functions.invoke('manage-users', {
        body: {
          action: 'create-user',
          email: employeeData.email,
          fullName: employeeData.full_name,
          role: employeeData.role,
          phone: employeeData.phone,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? 'Failed to create employee');
      return data.user as Profile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      return { success: true };
    },
  });
}

// ---- Case Hooks ----

export interface CaseFilters {
  status?: CaseStatus;
  priority?: CasePriority;
  technician_id?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function useCases(filters: CaseFilters = {}) {
  const { status, priority, technician_id, search, page = 1, pageSize = 20 } = filters;

  return useQuery({
    queryKey: ['cases', filters],
    queryFn: async () => {
      const columns = '*, dentist:dentists(*), assigned_technician:profiles!cases_assigned_technician_id_fkey(*)';
      // Search text goes to the database as a parameter, never into the filter
      // string (migration 011, KNOWN_ISSUES #11).
      let query = search?.trim()
        ? supabase.rpc('search_cases', { p_query: search }, { count: 'exact' }).select(columns)
        : supabase.from('cases').select(columns, { count: 'exact' });

      if (status) query = query.eq('current_status', status);
      if (priority) query = query.eq('priority', priority);
      if (technician_id) query = query.eq('assigned_technician_id', technician_id);

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return { data: data as Case[], count: count || 0, page, pageSize };
    },
  });
}

export function useCase(caseId: string | undefined) {
  return useQuery({
    queryKey: ['case', caseId],
    queryFn: async () => {
      if (!caseId) return null;
      const { data, error } = await supabase
        .from('cases')
        .select('*, dentist:dentists(*), assigned_technician:profiles!cases_assigned_technician_id_fkey(*), registered_by_profile:profiles!cases_registered_by_fkey(*)')
        .eq('id', caseId)
        .single();
      if (error) throw error;
      return data as Case;
    },
    enabled: !!caseId,
  });
}

export function useCaseByNumber(caseNumber: string | undefined) {
  return useQuery({
    queryKey: ['case', 'number', caseNumber],
    queryFn: async () => {
      if (!caseNumber) return null;
      const { data, error } = await supabase
        .from('cases')
        .select('*, dentist:dentists(*), assigned_technician:profiles!cases_assigned_technician_id_fkey(*)')
        .eq('case_number', caseNumber)
        .single();
      if (error) throw error;
      return data as Case;
    },
    enabled: !!caseNumber,
  });
}

export function useCreateCase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (caseData: Partial<Case>) => {
      const { data, error } = await supabase
        .from('cases')
        .insert(caseData)
        .select()
        .single();
      if (error) throw error;
      return data as Case;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });
    },
  });
}

export function useUpdateCase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Case> & { id: string }) => {
      const { data, error } = await supabase
        .from('cases')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as Case;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      queryClient.invalidateQueries({ queryKey: ['case', data.id] });
    },
  });
}

export function useUpdateCaseStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ caseId, newStatus, notes }: { caseId: string; newStatus: CaseStatus; notes?: string }) => {
      // One atomic call: the trigger validates the transition and writes the event
      const { data, error } = await supabase.rpc('transition_case_status', {
        p_case_id: caseId,
        p_new_status: newStatus,
        p_notes: notes || null,
      });
      if (error) throw error;
      return data as Case;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      queryClient.invalidateQueries({ queryKey: ['case', data.id] });
      queryClient.invalidateQueries({ queryKey: ['case-events', data.id] });
    },
  });
}

export function useAssignTechnician() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ caseId, technicianId }: {
      caseId: string;
      technicianId: string;
    }) => {
      // One update: database triggers write the assignment history and the event
      // in the same transaction (migration 007).
      const { data: caseData, error: caseError } = await supabase
        .from('cases')
        .update({
          assigned_technician_id: technicianId,
          assigned_at: new Date().toISOString(),
          current_status: 'assigned' as CaseStatus,
        })
        .eq('id', caseId)
        .select()
        .single();
      if (caseError) throw caseError;

      return caseData as Case;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      queryClient.invalidateQueries({ queryKey: ['case', data.id] });
      queryClient.invalidateQueries({ queryKey: ['case-events', data.id] });
    },
  });
}

// ---- Case Events ----

export function useCaseEvents(caseId: string | undefined) {
  return useQuery({
    queryKey: ['case-events', caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const { data, error } = await supabase
        .from('case_events')
        .select('*, actor:profiles!case_events_actor_id_fkey(*), sender:profiles!case_events_sender_id_fkey(*), receiver:profiles!case_events_receiver_id_fkey(*)')
        .eq('case_id', caseId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as CaseEvent[];
    },
    enabled: !!caseId,
  });
}

export function useCreateCaseEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      case_id: string;
      event_type: string;
      previous_status?: CaseStatus;
      new_status?: CaseStatus;
      notes?: string;
      sender_id?: string;
      receiver_id?: string;
      batch_id?: string;
    }) => {
      const { data, error } = await supabase.rpc('record_case_event', {
        p_case_id: params.case_id,
        p_event_type: params.event_type,
        p_previous_status: params.previous_status || null,
        p_new_status: params.new_status || null,
        p_notes: params.notes || null,
        p_sender_id: params.sender_id || null,
        p_receiver_id: params.receiver_id || null,
        p_batch_id: params.batch_id || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['case-events', variables.case_id] });
    },
  });
}

// ---- Dentists ----

export function useDentists() {
  return useQuery({
    queryKey: ['dentists'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dentists')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data as Dentist[];
    },
  });
}

export function useAllDentists() {
  return useQuery({
    queryKey: ['dentists', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dentists')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as Dentist[];
    },
  });
}

export function useCreateDentist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (dentist: Partial<Dentist>) => {
      const { data, error } = await supabase
        .from('dentists')
        .insert(dentist)
        .select()
        .single();
      if (error) throw error;
      return data as Dentist;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dentists'] });
    },
  });
}

export function useUpdateDentist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Dentist> & { id: string }) => {
      const { data, error } = await supabase
        .from('dentists')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as Dentist;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dentists'] });
    },
  });
}

// ---- Work Types (owner-managed, migration 005) ----

/** Active types for everyone; the owner may pass includeInactive to manage the list. */
export function useWorkTypes({ includeInactive = false }: { includeInactive?: boolean } = {}) {
  return useQuery({
    queryKey: ['work-types', { includeInactive }],
    queryFn: async () => {
      let query = supabase.from('work_types').select('*');
      if (!includeInactive) query = query.eq('is_active', true);
      const { data, error } = await query.order('sort_order').order('name');
      if (error) throw error;
      return data as WorkType[];
    },
  });
}

export function useCreateWorkType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (workType: { name: string; sort_order: number }) => {
      const { data, error } = await supabase.from('work_types').insert(workType).select().single();
      if (error) throw error;
      return data as WorkType;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-types'] });
    },
  });
}

export function useUpdateWorkType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Pick<WorkType, 'name' | 'is_active' | 'sort_order'>> & { id: string }) => {
      const { data, error } = await supabase.from('work_types').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data as WorkType;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-types'] });
    },
  });
}

// ---- Delivery Batches ----

export function useBatches(filters: { type?: string; status?: string; page?: number; pageSize?: number } = {}) {
  const { type, status, page = 1, pageSize = 20 } = filters;

  return useQuery({
    queryKey: ['batches', filters],
    queryFn: async () => {
      let query = supabase
        .from('delivery_batches')
        .select('*, representative:profiles!delivery_batches_representative_id_fkey(*), receptionist:profiles!delivery_batches_receptionist_id_fkey(*)', { count: 'exact' });

      if (type) query = query.eq('batch_type', type);
      if (status) query = query.eq('status', status);

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return { data: data as DeliveryBatch[], count: count || 0, page, pageSize };
    },
  });
}

export function useCreateBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (batch: Partial<DeliveryBatch>) => {
      const { data, error } = await supabase
        .from('delivery_batches')
        .insert(batch)
        .select()
        .single();
      if (error) throw error;
      return data as DeliveryBatch;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
    },
  });
}

export function useUpdateBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<DeliveryBatch> & { id: string }) => {
      const { data, error } = await supabase
        .from('delivery_batches')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as DeliveryBatch;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
    },
  });
}

// ---- Batch Cases ----

export function useBatchCases(batchId: string | undefined) {
  return useQuery({
    queryKey: ['batch-cases', batchId],
    queryFn: async () => {
      if (!batchId) return [];
      const { data, error } = await supabase
        .from('batch_cases')
        .select('*, case:cases(*)')
        .eq('batch_id', batchId);
      if (error) throw error;
      return data;
    },
    enabled: !!batchId,
  });
}

export function useAddCaseToBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ batchId, caseId }: { batchId: string; caseId: string }) => {
      // added_by and the batch's actual_count are set by the database (migration 010).
      const { error } = await supabase
        .from('batch_cases')
        .insert({ batch_id: batchId, case_id: caseId });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['batch-cases', variables.batchId] });
      queryClient.invalidateQueries({ queryKey: ['batches'] });
    },
  });
}

// ---- Audit Logs ----

export function useAuditLogs(page = 1, pageSize = 50) {
  return useQuery({
    queryKey: ['audit-logs', page, pageSize],
    queryFn: async () => {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await supabase
        .from('audit_logs')
        .select('*, actor:profiles!audit_logs_actor_id_fkey(*)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return { data: data as AuditLog[], count: count || 0, page, pageSize };
    },
  });
}

export interface DashboardStats extends Record<CaseStatus, number> {
  overdue: number;
  total: number;
  activeEmployees: number;
}

export function useDashboardStats() {
  return useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const statuses: CaseStatus[] = [
        'intake_pending', 'registered', 'awaiting_assignment', 'assigned',
        'in_progress', 'completed', 'awaiting_reception_receipt',
        'received_by_reception', 'awaiting_representative_pickup',
        'with_representative', 'delivered', 'on_hold', 'rework_required', 'cancelled',
      ];

      const counts: Record<string, number> = {};

      for (const status of statuses) {
        const { count } = await supabase
          .from('cases')
          .select('*', { count: 'exact', head: true })
          .eq('current_status', status);
        counts[status] = count || 0;
      }

      // Overdue cases
      const { count: overdueCount } = await supabase
        .from('cases')
        .select('*', { count: 'exact', head: true })
        .lt('due_date', new Date().toISOString().split('T')[0])
        .not('current_status', 'in', '("delivered","cancelled")');

      // Total cases
      const { count: totalCount } = await supabase
        .from('cases')
        .select('*', { count: 'exact', head: true });

      // Active employees
      const { count: activeEmployees } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');

      return {
        ...counts,
        overdue: overdueCount || 0,
        total: totalCount || 0,
        activeEmployees: activeEmployees || 0,
      } as DashboardStats;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}
