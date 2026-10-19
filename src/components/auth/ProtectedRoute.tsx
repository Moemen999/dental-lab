import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Spinner } from '@/components/ui/Spinner';
import type { AppRole } from '@/types/database';
import { t } from '@/i18n';

interface ProtectedRouteProps {
  allowedRoles?: AppRole[];
}

export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user || !profile) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (profile.status !== 'active') {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900">{t('auth.accessDenied.title')}</h1>
          <p className="text-slate-600 mt-2">{t('auth.accessDenied.description')}</p>
          <a href="/" className="text-brand-teal hover:underline mt-4 inline-block">
            {t('auth.accessDenied.goHome')}
          </a>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
