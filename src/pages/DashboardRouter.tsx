import { useAuth } from '@/contexts/AuthContext';
import { OwnerDashboard } from '@/pages/OwnerDashboard';
import { TechnicianDashboard } from '@/pages/TechnicianDashboard';
import { ReceptionDashboard } from '@/pages/ReceptionDashboard';
import { RepresentativeDashboard } from '@/pages/RepresentativeDashboard';
import { Spinner } from '@/components/ui/Spinner';

export function DashboardRouter() {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!profile) return null;

  switch (profile.role) {
    case 'owner':
      return <OwnerDashboard />;
    case 'technician':
      return <TechnicianDashboard />;
    case 'receptionist':
      return <ReceptionDashboard />;
    case 'representative':
      return <RepresentativeDashboard />;
    default:
      return <OwnerDashboard />;
  }
}
