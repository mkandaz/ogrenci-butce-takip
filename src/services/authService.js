import { supabase, isSupabaseConfigured } from './supabaseClient.js';

export class AuthService {
  constructor() {
    this.currentUser = null;
    this.currentSession = null;
    this.authListeners = [];

    if (isSupabaseConfigured() && supabase) {
      // Başlangıç oturumunu al
      supabase.auth.getSession().then(({ data }) => {
        this.currentSession = data?.session || null;
        this.currentUser = data?.session?.user || null;
        this.notify(this.currentUser, this.currentSession);
      }).catch(err => {
        console.warn('[AuthService] getSession hatası:', err);
      });

      // Oturum değişimlerini dinle
      supabase.auth.onAuthStateChange((event, session) => {
        this.currentSession = session;
        this.currentUser = session?.user || null;
        this.notify(this.currentUser, session, event);
      });
    }
  }

  isConfigured() {
    return isSupabaseConfigured();
  }

  isLoggedIn() {
    return Boolean(this.currentUser);
  }

  getUser() {
    return this.currentUser;
  }

  getSession() {
    return this.currentSession;
  }

  async signInWithMagicLink(email) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      throw new Error('Lütfen geçerli bir e-posta adresi girin.');
    }

    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Supabase bağlantısı henüz yapılandırılmamış.');
    }

    const redirectTo = typeof window !== 'undefined' ? window.location.origin : '';
    const { data, error } = await supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: {
        emailRedirectTo: redirectTo
      }
    });

    if (error) {
      throw error;
    }
    return data;
  }

  async signOut() {
    if (!isSupabaseConfigured() || !supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.warn('[AuthService] signOut hatası:', error);
    }
    this.currentUser = null;
    this.currentSession = null;
    this.notify(null, null, 'SIGNED_OUT');
  }

  onAuthStateChange(callback) {
    if (typeof callback === 'function') {
      this.authListeners.push(callback);
      // İlk durumu anında bildir
      if (this.currentUser) {
        callback(this.currentUser, this.currentSession, 'INITIAL');
      }
    }
    return () => {
      this.authListeners = this.authListeners.filter(cb => cb !== callback);
    };
  }

  notify(user, session, event = null) {
    this.authListeners.forEach(cb => {
      try {
        cb(user, session, event);
      } catch (err) {
        console.error('[AuthService] Listener hatası:', err);
      }
    });
  }
}

export const authService = new AuthService();
