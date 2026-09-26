/**
 * ==============================================================================
 * js/supabase.js - Centralized Supabase Client Singleton & Toast Notifications
 * ==============================================================================
 * Safe frontend configuration for static GitHub Pages hosting.
 * Uses ONLY the public Project URL and Anon/Publishable Key.
 * NEVER imports or exposes the Supabase service-role key in client-side code.
 */

import { APP_CONFIG } from './config.js';

let supabaseClient = null;

/**
 * Returns a singleton instance of the Supabase JavaScript client.
 * Compatible with static GitHub Pages hosting (loads via CDN as window.supabase).
 */
export function getSupabase() {
  if (supabaseClient) {
    return supabaseClient;
  }

  if (typeof window.supabase === 'undefined') {
    console.error(
      'Supabase client library is not loaded. ' +
      'Ensure `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>` is in your HTML <head>.'
    );
    return null;
  }

  if (!APP_CONFIG.IS_CONFIGURED()) {
    console.warn('Supabase URL or Anon key has not been configured yet in js/config.js.');
    return null;
  }

  try {
    supabaseClient = window.supabase.createClient(
      APP_CONFIG.SUPABASE_URL,
      APP_CONFIG.SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: window.localStorage
        }
      }
    );

    return supabaseClient;
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err);
    return null;
  }
}

/**
 * Lightweight Toast Notification Utility for UI Feedback.
 * The message is rendered as plain text.
 */
export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconMap = {
    info: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    warning: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    danger: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
  };

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.innerHTML = iconMap[type] || iconMap.info;

  const text = document.createElement('span');
  text.style.flex = '1';
  text.textContent = message;

  toast.append(icon, text);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
