-- ==============================================================================
-- 02_security_rls.sql: Row Level Security (RLS) & Authorization
-- Target Database: PostgreSQL 14+ (Supabase)
-- ==============================================================================

-- 1. Helper function: Check if caller has teacher/admin role
CREATE OR REPLACE FUNCTION public.is_teacher()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('teacher', 'admin')
    );
$$;

-- 2. Enable Row Level Security on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_answers ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- PROFILES POLICIES
-- ==============================================================================

-- Students can read their own profile; teachers can read all profiles
CREATE POLICY "Profiles are viewable by owner or teacher"
ON public.profiles
FOR SELECT
TO authenticated
USING (
    id = auth.uid() OR public.is_teacher()
);

-- Users can update their own profile (name, section only; student_id and email are locked)
CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid() OR public.is_teacher())
WITH CHECK (
    public.is_teacher() 
    OR (
        id = auth.uid() 
        AND role = 'student'
        AND student_id = (SELECT p.student_id FROM public.profiles p WHERE p.id = auth.uid())
        AND email = (SELECT p.email FROM public.profiles p WHERE p.id = auth.uid())
    )
);

-- ==============================================================================
-- QUIZZES POLICIES
-- ==============================================================================

-- Students can view published or closed quizzes; teachers can view all (including drafts)
CREATE POLICY "Quizzes viewable by status and role"
ON public.quizzes
FOR SELECT
TO authenticated
USING (
    public.is_teacher() OR status IN ('published', 'closed')
);

-- Only teachers can insert quizzes
CREATE POLICY "Teachers can insert quizzes"
ON public.quizzes
FOR INSERT
TO authenticated
WITH CHECK (public.is_teacher());

-- Only teachers can update quizzes
CREATE POLICY "Teachers can update quizzes"
ON public.quizzes
FOR UPDATE
TO authenticated
USING (public.is_teacher())
WITH CHECK (public.is_teacher());

-- Only teachers can delete quizzes (only allowed if no student attempts exist)
CREATE POLICY "Teachers can delete quizzes without attempts"
ON public.quizzes
FOR DELETE
TO authenticated
USING (
    public.is_teacher() 
    AND NOT EXISTS (SELECT 1 FROM public.quiz_attempts WHERE quiz_id = quizzes.id)
);

-- ==============================================================================
-- QUESTIONS POLICIES & ANTI-CHEAT VIEW
-- ==============================================================================

-- Only teachers can modify questions
CREATE POLICY "Teachers can insert questions"
ON public.questions
FOR INSERT
TO authenticated
WITH CHECK (public.is_teacher());

CREATE POLICY "Teachers can update questions"
ON public.questions
FOR UPDATE
TO authenticated
USING (
    public.is_teacher()
    AND NOT EXISTS (SELECT 1 FROM public.quiz_attempts WHERE quiz_id = questions.quiz_id)
)
WITH CHECK (public.is_teacher());

CREATE POLICY "Teachers can delete questions"
ON public.questions
FOR DELETE
TO authenticated
USING (
    public.is_teacher()
    AND NOT EXISTS (SELECT 1 FROM public.quiz_attempts WHERE quiz_id = questions.quiz_id)
);

-- Teachers can view all question fields including correct_option
CREATE POLICY "Teachers can view all questions"
ON public.questions
FOR SELECT
TO authenticated
USING (public.is_teacher());

-- Students should NOT be able to view correct_option from questions table directly.
-- We provide a public view 'student_questions' that explicitly OMITS correct_option.
CREATE OR REPLACE VIEW public.student_questions AS
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
WHERE z.status IN ('published', 'closed');

-- ==============================================================================
-- QUIZ ATTEMPTS POLICIES
-- ==============================================================================

-- Students can only view their own attempts; teachers can view all
CREATE POLICY "Attempts viewable by student owner or teacher"
ON public.quiz_attempts
FOR SELECT
TO authenticated
USING (
    student_id = auth.uid() OR public.is_teacher()
);

-- Security Hardening: Direct student INSERT is revoked.
-- Attempts are created and scored exclusively by the submit_quiz() SECURITY DEFINER RPC.
CREATE POLICY "Teachers can manage attempts"
ON public.quiz_attempts
FOR ALL
TO authenticated
USING (public.is_teacher())
WITH CHECK (public.is_teacher());

-- ==============================================================================
-- ATTEMPT ANSWERS POLICIES
-- ==============================================================================

-- Students can only view their own answers; teachers can view all
CREATE POLICY "Attempt answers viewable by owner or teacher"
ON public.attempt_answers
FOR SELECT
TO authenticated
USING (
    public.is_teacher() OR EXISTS (
        SELECT 1 FROM public.quiz_attempts a
        WHERE a.id = attempt_answers.attempt_id AND a.student_id = auth.uid()
    )
);

-- Security Hardening: Direct student answer insertion is revoked.
CREATE POLICY "Teachers can manage attempt answers"
ON public.attempt_answers
FOR ALL
TO authenticated
USING (public.is_teacher())
WITH CHECK (public.is_teacher());
