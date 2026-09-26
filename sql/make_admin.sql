-- ==============================================================================
-- sql/make_admin.sql — change an existing account's role
-- ==============================================================================
-- Run in Supabase → SQL Editor. The person must have registered on the site first.
--
--   'admin'   – can see and manage every teacher's courses (use sparingly)
--   'teacher' – manages only their own courses
--   'student' – takes quizzes
--
-- Replace the email below, pick the role, then click Run.
-- ==============================================================================

UPDATE public.profiles
SET role = 'admin'           -- or 'teacher' / 'student'
WHERE email = 'teacher@college.edu';

SELECT id, full_name, email, role FROM public.profiles WHERE email = 'teacher@college.edu';
