-- ==============================================================================
-- sql/reset_student_password.sql
-- Quick Manual Password Override for Instructors / Admins
-- ==============================================================================
--
-- USE CASE:
-- If a student forgets their password right before or during a live class quiz,
-- waiting for an email can cause delays. As an instructor/admin, you can run this
-- 1-second query in the Supabase SQL Editor to set a temporary password immediately.
--
-- INSTRUCTIONS:
-- 1. Replace 'student@college.edu' with the student's email address.
-- 2. Replace 'Student2026!' with the desired temporary password.
-- 3. Click "RUN" in the Supabase SQL Editor.
-- 4. Tell the student to log in with this temporary password.
-- ==============================================================================

UPDATE auth.users
SET 
    encrypted_password = crypt('Student2026!', gen_salt('bf')),
    updated_at = NOW()
WHERE email = 'student@college.edu';

-- OPTIONAL: Verify the update was applied
SELECT id, email, role, updated_at 
FROM auth.users 
WHERE email = 'student@college.edu';
