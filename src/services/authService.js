import { supabase, isSupabaseConfigured } from './supabaseClient.js';

export function hasAuthParamsInUrl() {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  return (
    hash.includes('access_token=') ||
    hash.includes('refresh_token=') ||
    hash.includes('type=magiclink') ||
    hash.includes('type=recovery') ||
    search.includes('code=')
  );
}

export class AuthService {
  constructor(customClient = null) {
    this.client = customClient;
    this.currentUser = null;
    this.currentSession = null;
    this.authListeners = [];
    this.isReady = false;

    const client = this.getClient();
    if ((this.client || isSupabaseConfigured()) && client) {
      this.readyPromise = (async () => {
        try {
          const { data, error } = await client.auth.getSession();
          if (error) console.warn('[AuthService] getSession uyarısı:', error.message);
          this.currentSession = data?.session || null;
          this.currentUser = data?.session?.user || null;
          this.isReady = true;
          this.notify(this.currentUser, this.currentSession, 'INITIAL');
          return this.currentUser;
        } catch (err) {
          console.warn('[AuthService] getSession hatası:', err);
          this.isReady = true;
          return null;
        }
      })();

      // Oturum değişimlerini dinle
      client.auth.onAuthStateChange((event, session) => {
        this.currentSession = session;
        this.currentUser = session?.user || null;
        this.isReady = true;
        this.notify(this.currentUser, session, event);
      });
    } else {
      this.isReady = true;
      this.readyPromise = Promise.resolve(null);
    }
  }

  getClient() {
    return this.client || supabase;
  }

  isConfigured() {
    return Boolean(this.client || isSupabaseConfigured());
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

  async waitForAuth(timeoutMs = 2500) {
    if (!this.isConfigured()) {
      return null;
    }
    if (this.currentUser) {
      return this.currentUser;
    }

    const hasAuth = hasAuthParamsInUrl();
    const waitPromise = new Promise((resolve) => {
      if (this.readyPromise) {
        this.readyPromise.then((user) => {
          if (user) {
            return resolve(user);
          }
          // URL'de auth token/code varsa onAuthStateChange SIGNED_IN eventini bekle
          if (hasAuth) {
            const unsub = this.onAuthStateChange((signedInUser, session, event) => {
              if (signedInUser) {
                unsub();
                resolve(signedInUser);
              }
            });
            setTimeout(() => {
              unsub();
              resolve(this.currentUser);
            }, timeoutMs - 100);
          } else {
            resolve(null);
          }
        });
      } else {
        resolve(null);
      }
    });

    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(this.currentUser), timeoutMs));
    return Promise.race([waitPromise, timeoutPromise]);
  }

  async signInWithMagicLink(email) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      throw new Error('Lütfen geçerli bir e-posta adresi girin.');
    }

    const client = this.getClient();
    if (!this.isConfigured() || !client) {
      throw new Error('Supabase bağlantısı henüz yapılandırılmamış.');
    }

    const redirectTo = typeof window !== 'undefined' ? window.location.origin : '';
    const { data, error } = await client.auth.signInWithOtp({
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
    const client = this.getClient();
    if (!this.isConfigured() || !client) return;
    const { error } = await client.auth.signOut();
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
