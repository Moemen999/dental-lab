import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/contexts/AuthContext';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { LoginPage } from '@/components/auth/LoginPage';
import { AppLayout } from '@/components/layout/AppLayout';
import { DashboardRouter } from '@/pages/DashboardRouter';
import { CasesPage } from '@/pages/CasesPage';
import { CaseDetailPage } from '@/pages/CaseDetailPage';
import { CaseRegistrationPage } from '@/pages/CaseRegistrationPage';
import { BatchesPage } from '@/pages/BatchesPage';
import { DentistsPage } from '@/pages/DentistsPage';
import { EmployeesPage } from '@/pages/EmployeesPage';
import { AuditLogsPage } from '@/pages/AuditLogsPage';
import { WorkTypesPage } from '@/pages/WorkTypesPage';
import { RepresentativeDashboard } from '@/pages/RepresentativeDashboard';
import { Toaster } from 'sonner';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public Auth Route */}
            <Route path="/login" element={<LoginPage />} />

            {/* Protected Routes */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                {/* Role-adaptive Home Dashboard */}
                <Route path="/" element={<DashboardRouter />} />

                {/* Case Management */}
                <Route path="/cases" element={<CasesPage />} />
                <Route path="/cases/:id" element={<CaseDetailPage />} />
                <Route
                  path="/cases/new"
                  element={
                    <ProtectedRoute allowedRoles={['owner', 'receptionist']} />
                  }
                >
                  <Route index element={<CaseRegistrationPage />} />
                </Route>

                {/* Delivery Batches */}
                <Route path="/batches" element={<BatchesPage />} />

                {/* Dentists & Clinics */}
                <Route
                  path="/dentists"
                  element={
                    <ProtectedRoute allowedRoles={['owner', 'receptionist']} />
                  }
                >
                  <Route index element={<DentistsPage />} />
                </Route>

                {/* Staff & Employees (Owner only) */}
                <Route
                  path="/employees"
                  element={<ProtectedRoute allowedRoles={['owner']} />}
                >
                  <Route index element={<EmployeesPage />} />
                </Route>

                {/* Work types list (Owner only) */}
                <Route
                  path="/work-types"
                  element={<ProtectedRoute allowedRoles={['owner']} />}
                >
                  <Route index element={<WorkTypesPage />} />
                </Route>

                {/* System Audit Logs (Owner only) */}
                <Route
                  path="/audit"
                  element={<ProtectedRoute allowedRoles={['owner']} />}
                >
                  <Route index element={<AuditLogsPage />} />
                </Route>

                {/* Representative Deliveries */}
                <Route path="/deliveries" element={<RepresentativeDashboard />} />
              </Route>
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        {/* Mirrored for RTL: top-right in an LTR app becomes top-left. */}
        <Toaster position="top-left" dir="rtl" richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
