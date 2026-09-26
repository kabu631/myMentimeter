-- ==============================================================================
-- sql/make_admin.sql — change an existing account's role
-- ==============================================================================
-- Run in Supabase → SQL Editor. The person must have an account already.
-- Only needed for the FIRST super admin: after that, admins manage roles on the
-- Accounts page (admin/accounts.html).
--
--   'admin'   – super admin: every subject, plus the Accounts page (use sparingly)
--   'teacher' – manages only their own subjects
--   'student' – takes quizzes
--
-- Replace the email below, pick the role, then click Run.
-- ==============================================================================

UPDATE public.profiles
SET role = 'admin', class_id = NULL, student_id = NULL   -- or role = 'teacher' / 'student'
WHERE lower(email) = lower('teacher@college.edu');

SELECT id, full_name, email, role FROM public.profiles WHERE email = 'teacher@college.edu';
