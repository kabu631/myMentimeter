-- ==============================================================================
-- sql/reset_student_password.sql — set a temporary password for any account
-- ==============================================================================
-- Use when someone forgets their password right before a quiz and the reset
-- email is slow (Supabase's built-in email service only sends a few emails per hour).
--
-- 1. Replace the email and the temporary password below.
-- 2. Run in Supabase → SQL Editor.
-- 3. Tell the student to sign in with it, then change it from their Profile page.
-- ==============================================================================

UPDATE auth.users
SET encrypted_password = extensions.crypt('Temp-2026!', extensions.gen_salt('bf')),
    updated_at = now()
WHERE email = 'student@college.edu';

SELECT id, email, updated_at FROM auth.users WHERE email = 'student@college.edu';
