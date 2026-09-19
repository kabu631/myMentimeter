-- ==============================================================================
-- 06_security_hardening.sql: Complete RLS & Anti-Cheat Hardening Patch
-- Target Database: PostgreSQL 14+ (Supabase)
-- 
-- Run this in Supabase SQL Editor to enforce strict server-side grading
-- and close direct table INSERT vulnerabilities.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. FIX VULNERABILITY: Revoke Direct INSERT on quiz_attempts & attempt_answers
-- ------------------------------------------------------------------------------
-- Students must NEVER directly insert records into quiz_attempts or attempt_answers.
-- All grading and attempt creation MUST be handled atomically by the SECURITY DEFINER
-- stored procedure public.submit_quiz().

DROP POLICY IF EXISTS "Students can insert own attempts" ON public.quiz_attempts;
DROP POLICY IF EXISTS "Students can insert own attempt answers" ON public.attempt_answers;

-- Only teachers/admins are allowed direct write access to attempts (for grade adjustments)
DROP POLICY IF EXISTS "Teachers can manage attempts" ON public.quiz_attempts;
CREATE POLICY "Teachers can manage attempts"
ON public.quiz_attempts FOR ALL TO authenticated
USING (public.is_teacher())
WITH CHECK (public.is_teacher());

DROP POLICY IF EXISTS "Teachers can manage attempt answers" ON public.attempt_answers;
CREATE POLICY "Teachers can manage attempt answers"
ON public.attempt_answers FOR ALL TO authenticated
USING (public.is_teacher())
WITH CHECK (public.is_teacher());

-- ------------------------------------------------------------------------------
-- 2. FIX VULNERABILITY: Prevent Student Profile Tampering & Privilege Escalation
-- ------------------------------------------------------------------------------
-- Ensure students cannot change their role, student_id, or email after signup.
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid() OR public.is_teacher())
WITH CHECK (
    public.is_teacher() 
    OR (
        id = auth.uid() 
        AND role = 'student'
        -- Prevent student from changing their registered student_id (roll number)
        AND student_id = (SELECT p.student_id FROM public.profiles p WHERE p.id = auth.uid())
        -- Prevent student from changing their registered email
        AND email = (SELECT p.email FROM public.profiles p WHERE p.id = auth.uid())
    )
);

-- ------------------------------------------------------------------------------
-- 3. HARDEN VIEW: Secure Student Questions View with Security Barrier
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.student_questions 
WITH (security_barrier = true) AS
SELECT 
    q.id,
    q.quiz_id,
    q.question_text,
    q.question_type,
    q.options,
    q.marks,
    q.order_index
FROM public.questions q
JOIN public.quizzes z ON z.id = q.quiz_id
WHERE z.status IN ('published', 'closed') OR public.is_teacher();

-- ------------------------------------------------------------------------------
-- 4. PERMISSIONS AUDIT: Ensure Execute Rights on Stored Procedures
-- ------------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.submit_quiz(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_attempt_review(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_teacher() TO authenticated;
