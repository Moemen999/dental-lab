import { useState, type FormEvent } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Eye, EyeOff } from 'lucide-react';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { usePageTitle } from '@/hooks/usePageTitle';

export function LoginPage() {
  usePageTitle(t('auth.login.pageTitle'));
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!email.trim() || !password.trim()) {
      setError(t('auth.login.missingFields'));
      setLoading(false);
      return;
    }

    const { error: authError } = await signIn(email, password);
    setLoading(false);

    if (authError) {
      setError(errorMessage(authError));
    } else {
      navigate('/', { replace: true });
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-50">
      {/* Brand hero: the logo always sits on its own dark teal background (never on white). */}
      <section className="flex flex-col items-center justify-center gap-6 bg-brand-teal px-6 py-10 text-center lg:w-1/2 lg:py-0">
        <img
          src="/branding/logo-panel.jpg"
          alt={t('common.app.logoAlt')}
          width={560}
          height={393}
          className="w-full max-w-[220px] sm:max-w-xs lg:max-w-md h-auto"
        />
        <div className="h-0.5 w-16 rounded-full bg-brand-red" aria-hidden="true" />
        <div>
          {/* Gold text only on teal (8.3:1). */}
          <h1 className="text-2xl lg:text-3xl font-bold text-brand-gold">{t('common.app.name')}</h1>
          <p className="mt-1 text-white/90">{t('common.app.subtitle')}</p>
        </div>
      </section>

      <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">

        <Card>
          <CardHeader>
            <CardTitle>{t('auth.login.heading')}</CardTitle>
            <CardDescription>{t('auth.login.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-md bg-red-50 border border-red-200 p-3" role="alert">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <Input
                label={t('auth.login.email')}
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.login.emailPlaceholder')}
                autoComplete="email"
                required
                disabled={loading}
              />

              <div className="relative">
                <Input
                  label={t('auth.login.password')}
                  type={showPassword ? 'text' : 'password'}
                  className="pe-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('auth.login.passwordPlaceholder')}
                  autoComplete="current-password"
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute end-3 top-[34px] text-slate-500 hover:text-slate-600"
                  tabIndex={-1}
                  aria-label={showPassword ? t('common.a11y.hidePassword') : t('common.a11y.showPassword')}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <Button
                type="submit"
                className="w-full"
                loading={loading}
                disabled={loading}
              >
                {t('auth.login.submit')}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-slate-500 mt-6">
          {t('auth.login.contactAdmin')}
        </p>
      </div>
      </div>
    </div>
  );
}
