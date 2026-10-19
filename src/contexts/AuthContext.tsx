import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { User, AuthError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile, AppRole } from '@/types/database';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  isOwner: boolean;
  isReceptionist: boolean;
  isTechnician: boolean;
  isRepresentative: boolean;
  hasRole: (role: AppRole) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }

    // Check if account is active
    if (data && data.status !== 'active') {
      // Deactivated accounts get signed out
      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
      return null;
    }

    return data as Profile;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const p = await fetchProfile(user.id);
    setProfile(p);
  }, [user, fetchProfile]);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        fetchProfile(session.user.id).then(p => {
          setProfile(p);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          setUser(session.user);
          const p = await fetchProfile(session.user.id);
          setProfile(p);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setProfile(null);
        } else if (event === 'TOKEN_REFRESHED' && session?.user) {
          // Re-check account status on token refresh
          const p = await fetchProfile(session.user.id);
          setProfile(p);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  };

  const hasRole = (role: AppRole) => profile?.role === role;

  const value: AuthContextType = {
    user,
    profile,
    loading,
    signIn,
    signOut,
    refreshProfile,
    isOwner: profile?.role === 'owner',
    isReceptionist: profile?.role === 'receptionist',
    isTechnician: profile?.role === 'technician',
    isRepresentative: profile?.role === 'representative',
    hasRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
