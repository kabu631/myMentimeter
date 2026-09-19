/**
 * ==============================================================================
 * js/supabase.js - Centralized Supabase Client Singleton & Connection Testing
 * ==============================================================================
 * Safe frontend configuration for static GitHub Pages hosting.
 * Uses ONLY the public Project URL and Anon/Publishable Key.
 * NEVER imports or exposes the Supabase service-role key in client-side code.
 */

import { APP_CONFIG } from './config.js';

let supabaseClient = null;

/**
 * Returns a singleton instance of the Supabase JavaScript client.
 * Compatible with static GitHub Pages hosting (loads via CDN or window.supabase).
 */
export function getSupabase() {
  if (supabaseClient) {
    return supabaseClient;
  }

  // Ensure the Supabase JS library is loaded in the browser
  if (typeof window.supabase === 'undefined') {
    console.error(
      'Supabase client library is not loaded. ' +
      'Ensure `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>` is in your HTML <head>.'
    );
    return null;
  }

  // Safety check: verify project URL and anon key are populated
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
 * Diagnostic function: Tests that the Supabase client can initialize
 * and communicate with the Supabase Auth and Database services.
 */
export async function testSupabaseConnection() {
  const client = getSupabase();

  if (!client) {
    return {
      success: false,
      message: 'Failed to initialize Supabase client. Check script tags and credentials.'
    };
  }

  try {
    // 1. Test Auth Service
    const { data: sessionData, error: sessionErr } = await client.auth.getSession();
    if (sessionErr) throw sessionErr;

    // 2. Test Database Reachability (queries public schema)
    const { data: dbData, error: dbErr } = await client
      .from('quizzes')
      .select('id, title, class_number')
      .limit(1);

    if (dbErr && dbErr.code !== 'PGRST116') {
      // If table doesn't exist yet, note it, but connection itself succeeded
      return {
        success: true,
        authConnected: true,
        dbConnected: false,
        message: 'Connected to Supabase, but database tables need to be created via SQL Editor.'
      };
    }

    return {
      success: true,
      authConnected: true,
      dbConnected: true,
      data: dbData,
      message: 'Supabase client initialized and connected to both Auth and PostgreSQL database successfully!'
    };
  } catch (err) {
    return {
      success: false,
      message: 'Connection failed: ' + err.message
    };
  }
}

/**
 * Lightweight Toast Notification Utility for UI Feedback
 */
export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
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

  toast.innerHTML = `
    <span class="toast-icon">${iconMap[type] || iconMap.info}</span>
    <span style="flex: 1;">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
