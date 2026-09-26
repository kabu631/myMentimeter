/**
 * config.js - Supabase & Application Configuration
 *
 * Replace SUPABASE_URL and SUPABASE_ANON_KEY with your project credentials from:
 * https://supabase.com/dashboard/project/_/settings/api
 *
 * NOTE: It is completely safe to expose the anon/publishable key in frontend code.
 * Row Level Security in sql/setup.sql decides what each user can read or write.
 * DO NOT EVER PUT YOUR SERVICE_ROLE KEY HERE.
 */

export const APP_CONFIG = {
  // 1. Supabase Credentials
  SUPABASE_URL: 'https://uehufarldrbavngpefug.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlaHVmYXJsZHJiYXZuZ3BlZnVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3NzI3NjAsImV4cCI6MjEwNTM0ODc2MH0.0Bnb-MR_m68gzsLTeiNAz0rZcdWmgbQ_Cq6z49naDLA',

  // 2. Branding (shown in the header, footer and sign-in pages)
  APP_NAME: 'DailyClassQuiz',
  INSTITUTION_NAME: 'College Daily Quiz Portal',

  // 3. UI Helpers
  IS_CONFIGURED: function() {
    return (
      this.SUPABASE_URL &&
      !this.SUPABASE_URL.includes('YOUR_SUPABASE_PROJECT_ID') &&
      this.SUPABASE_ANON_KEY &&
      !this.SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_PUBLIC_KEY')
    );
  }
};
