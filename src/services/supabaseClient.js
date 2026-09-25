import { createClient } from '@supabase/supabase-js';

// Güvenli ortam değişkeni okuyucu (Browser Vite import.meta.env veya Node process.env)
const getEnvVar = (name) => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[name]) {
    return import.meta.env[name];
  }
  if (typeof process !== 'undefined' && process.env && process.env[name]) {
    return process.env[name];
  }
  return '';
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL');
const supabasePublishableKey = getEnvVar('VITE_SUPABASE_PUBLISHABLE_KEY');

export const isSupabaseConfigured = () => {
  return Boolean(
    supabaseUrl &&
    supabasePublishableKey &&
    supabaseUrl.trim() !== '' &&
    supabasePublishableKey.trim() !== '' &&
    !supabaseUrl.includes('placeholder')
  );
};

export const supabase = isSupabaseConfigured()
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: typeof window !== 'undefined',
        storage: typeof window !== 'undefined' ? window.localStorage : undefined
      }
    })
  : null;

if (!isSupabaseConfigured() && typeof window !== 'undefined') {
  console.info(
    '[Supabase] Supabase URL veya Publishable Key tanımlı değil. Uygulama yerel (LocalStorage) modunda çalışmaya devam ediyor.'
  );
}

export const getSupabaseClient = () => supabase;

