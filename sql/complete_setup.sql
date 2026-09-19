-- ==============================================================================
-- COMPLETE DATABASE SETUP: Daily Class Quiz System
-- Target Project: https://supabase.com/dashboard/project/uehufarldrbavngpefug
-- 
-- Run this entire script in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/uehufarldrbavngpefug/sql/new
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABLES & RELATIONS
-- ------------------------------------------------------------------------------

-- Profiles Table (Linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'teacher', 'admin')),
    full_name TEXT NOT NULL,
    student_id TEXT UNIQUE, -- College Roll / Reg Number
    section TEXT DEFAULT 'A', -- Student Class Section (e.g., A, B, C)
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure section column exists if profiles was already created
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS section TEXT DEFAULT 'A';

-- Quizzes Table (Belongs to Classes 1 to 35)
CREATE TABLE IF NOT EXISTS public.quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_number INT NOT NULL CHECK (class_number BETWEEN 1 AND 35),
    title TEXT NOT NULL,
    description TEXT,
    scheduled_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
    time_limit_minutes INT DEFAULT NULL CHECK (time_limit_minutes IS NULL OR time_limit_minutes > 0),
    show_score_immediately BOOLEAN NOT NULL DEFAULT true,
    show_correct_answers BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_class_number UNIQUE (class_number)
);

-- Questions Table
CREATE TABLE IF NOT EXISTS public.questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL DEFAULT 'single_choice' CHECK (question_type IN ('single_choice', 'true_false')),
    options JSONB NOT NULL,
    correct_option TEXT NOT NULL, -- Protected from students
    marks NUMERIC(4, 2) NOT NULL DEFAULT 1.00 CHECK (marks > 0),
    order_index INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Quiz Attempts Table (Single-attempt guarantee)
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('in_progress', 'submitted', 'abandoned')),
    score NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    total_marks NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_student_quiz_attempt UNIQUE (quiz_id, student_id),
    CONSTRAINT chk_score_range CHECK (score >= 0 AND score <= total_marks)
);

-- Attempt Answers Table
CREATE TABLE IF NOT EXISTS public.attempt_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    selected_option TEXT,
    is_correct BOOLEAN NOT NULL DEFAULT false,
    marks_awarded NUMERIC(4, 2) NOT NULL DEFAULT 0.00 CHECK (marks_awarded >= 0),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_attempt_question UNIQUE (attempt_id, question_id)
);

-- ------------------------------------------------------------------------------
-- 2. INDEXES
-- ------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_quizzes_status_date ON public.quizzes(status, scheduled_date DESC);
CREATE INDEX IF NOT EXISTS idx_quizzes_class_number ON public.quizzes(class_number ASC);
CREATE INDEX IF NOT EXISTS idx_questions_quiz_order ON public.questions(quiz_id, order_index ASC);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student ON public.quiz_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz ON public.quiz_attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_attempt_answers_attempt ON public.attempt_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_profiles_student_id ON public.profiles(student_id);

-- ------------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (RLS)
-- ------------------------------------------------------------------------------

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

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_answers ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
DROP POLICY IF EXISTS "Profiles viewable by owner or teacher" ON public.profiles;
CREATE POLICY "Profiles viewable by owner or teacher"
ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR public.is_teacher());

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE TO authenticated
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

-- Quizzes Policies
DROP POLICY IF EXISTS "Quizzes viewable by status and role" ON public.quizzes;
CREATE POLICY "Quizzes viewable by status and role"
ON public.quizzes FOR SELECT TO authenticated
USING (public.is_teacher() OR status IN ('published', 'closed'));

DROP POLICY IF EXISTS "Teachers can insert quizzes" ON public.quizzes;
CREATE POLICY "Teachers can insert quizzes"
ON public.quizzes FOR INSERT TO authenticated
WITH CHECK (public.is_teacher());

DROP POLICY IF EXISTS "Teachers can update quizzes" ON public.quizzes;
CREATE POLICY "Teachers can update quizzes"
ON public.quizzes FOR UPDATE TO authenticated
USING (public.is_teacher())
WITH CHECK (public.is_teacher());

DROP POLICY IF EXISTS "Teachers can delete quizzes without attempts" ON public.quizzes;
CREATE POLICY "Teachers can delete quizzes without attempts"
ON public.quizzes FOR DELETE TO authenticated
USING (
    public.is_teacher()
    AND NOT EXISTS (SELECT 1 FROM public.quiz_attempts WHERE quiz_id = quizzes.id)
);

-- Questions Policies
DROP POLICY IF EXISTS "Teachers can view questions" ON public.questions;
CREATE POLICY "Teachers can view questions"
ON public.questions FOR SELECT TO authenticated
USING (public.is_teacher());

DROP POLICY IF EXISTS "Teachers can insert questions" ON public.questions;
CREATE POLICY "Teachers can insert questions"
ON public.questions FOR INSERT TO authenticated
WITH CHECK (public.is_teacher());

DROP POLICY IF EXISTS "Teachers can update questions without attempts" ON public.questions;
CREATE POLICY "Teachers can update questions without attempts"
ON public.questions FOR UPDATE TO authenticated
USING (
    public.is_teacher()
    AND NOT EXISTS (SELECT 1 FROM public.quiz_attempts WHERE quiz_id = questions.quiz_id)
)
WITH CHECK (public.is_teacher());

DROP POLICY IF EXISTS "Teachers can delete questions without attempts" ON public.questions;
CREATE POLICY "Teachers can delete questions without attempts"
ON public.questions FOR DELETE TO authenticated
USING (
    public.is_teacher()
    AND NOT EXISTS (SELECT 1 FROM public.quiz_attempts WHERE quiz_id = questions.quiz_id)
);

-- Public Student View without correct_option
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

-- Quiz Attempts Policies
DROP POLICY IF EXISTS "Attempts viewable by owner or teacher" ON public.quiz_attempts;
CREATE POLICY "Attempts viewable by owner or teacher"
ON public.quiz_attempts FOR SELECT TO authenticated
USING (student_id = auth.uid() OR public.is_teacher());

-- Security Hardening: Direct INSERT/UPDATE by students is revoked.
-- Attempts are created and scored exclusively by the submit_quiz() SECURITY DEFINER RPC.
DROP POLICY IF EXISTS "Students can insert own attempts" ON public.quiz_attempts;

DROP POLICY IF EXISTS "Teachers can manage attempts" ON public.quiz_attempts;
CREATE POLICY "Teachers can manage attempts"
ON public.quiz_attempts FOR ALL TO authenticated
USING (public.is_teacher())
WITH CHECK (public.is_teacher());

-- Attempt Answers Policies
DROP POLICY IF EXISTS "Attempt answers viewable by owner or teacher" ON public.attempt_answers;
CREATE POLICY "Attempt answers viewable by owner or teacher"
ON public.attempt_answers FOR SELECT TO authenticated
USING (
    public.is_teacher() OR EXISTS (
        SELECT 1 FROM public.quiz_attempts a
        WHERE a.id = attempt_answers.attempt_id AND a.student_id = auth.uid()
    )
);

-- Security Hardening: Direct answer insertion by students is revoked.
DROP POLICY IF EXISTS "Students can insert own attempt answers" ON public.attempt_answers;

DROP POLICY IF EXISTS "Teachers can manage attempt answers" ON public.attempt_answers;
CREATE POLICY "Teachers can manage attempt answers"
ON public.attempt_answers FOR ALL TO authenticated
USING (public.is_teacher())
WITH CHECK (public.is_teacher());

-- ------------------------------------------------------------------------------
-- 4. PROFILE AUTOMATION TRIGGER
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    f_name TEXT;
    s_id TEXT;
    s_sec TEXT;
BEGIN
    f_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
    s_id := NEW.raw_user_meta_data->>'student_id';
    s_sec := COALESCE(NEW.raw_user_meta_data->>'section', 'A');

    INSERT INTO public.profiles (id, role, full_name, student_id, section, email, created_at, updated_at)
    VALUES (NEW.id, 'student', f_name, s_id, s_sec, NEW.email, now(), now())
    ON CONFLICT (id) DO UPDATE
    SET 
        full_name = EXCLUDED.full_name,
        student_id = COALESCE(EXCLUDED.student_id, profiles.student_id),
        section = COALESCE(EXCLUDED.section, profiles.section),
        updated_at = now();

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------------------------
-- 5. ANTI-CHEAT SCORING STORED PROCEDURE (RPC)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_quiz(
    p_quiz_id UUID,
    p_answers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_student_id UUID := auth.uid();
    v_quiz RECORD;
    v_attempt_id UUID;
    v_q RECORD;
    v_total_marks NUMERIC(5,2) := 0.00;
    v_earned_score NUMERIC(5,2) := 0.00;
    v_user_ans TEXT;
    v_is_correct BOOLEAN;
    v_awarded NUMERIC(4,2);
    v_review_list JSONB := '[]'::JSONB;
BEGIN
    IF v_student_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
    END IF;

    SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Quiz not found.');
    END IF;

    IF v_quiz.status <> 'published' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This quiz is not currently accepting submissions.');
    END IF;

    IF EXISTS (SELECT 1 FROM public.quiz_attempts WHERE quiz_id = p_quiz_id AND student_id = v_student_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'You have already attempted this quiz.');
    END IF;

    INSERT INTO public.quiz_attempts (quiz_id, student_id, status, score, total_marks, started_at, submitted_at)
    VALUES (p_quiz_id, v_student_id, 'submitted', 0.00, 0.00, now(), now())
    RETURNING id INTO v_attempt_id;

    FOR v_q IN 
        SELECT id, marks, correct_option, question_text, options 
        FROM public.questions 
        WHERE quiz_id = p_quiz_id 
        ORDER BY order_index ASC
    LOOP
        v_total_marks := v_total_marks + v_q.marks;

        SELECT ans->>'selected_option' INTO v_user_ans
        FROM jsonb_array_elements(p_answers) ans
        WHERE (ans->>'question_id')::UUID = v_q.id;

        IF v_user_ans IS NOT NULL AND UPPER(TRIM(v_user_ans)) = UPPER(TRIM(v_q.correct_option)) THEN
            v_is_correct := true;
            v_awarded := v_q.marks;
            v_earned_score := v_earned_score + v_awarded;
        ELSE
            v_is_correct := false;
            v_awarded := 0.00;
        END IF;

        INSERT INTO public.attempt_answers (attempt_id, question_id, selected_option, is_correct, marks_awarded, submitted_at)
        VALUES (v_attempt_id, v_q.id, v_user_ans, v_is_correct, v_awarded, now());

        IF v_quiz.show_correct_answers THEN
            v_review_list := v_review_list || jsonb_build_object(
                'question_id', v_q.id,
                'question_text', v_q.question_text,
                'selected_option', v_user_ans,
                'correct_option', v_q.correct_option,
                'is_correct', v_is_correct,
                'marks_awarded', v_awarded,
                'marks_possible', v_q.marks
            );
        END IF;
    END LOOP;

    UPDATE public.quiz_attempts
    SET score = v_earned_score, total_marks = v_total_marks, submitted_at = now()
    WHERE id = v_attempt_id;

    RETURN jsonb_build_object(
        'success', true,
        'attempt_id', v_attempt_id,
        'score', v_earned_score,
        'total_marks', v_total_marks,
        'percentage', CASE WHEN v_total_marks > 0 THEN ROUND((v_earned_score / v_total_marks) * 100, 1) ELSE 0 END,
        'show_score_immediately', v_quiz.show_score_immediately,
        'show_correct_answers', v_quiz.show_correct_answers,
        'review', CASE WHEN v_quiz.show_correct_answers THEN v_review_list ELSE NULL END
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. SAMPLE CLASS 01 QUIZ SEED
-- ------------------------------------------------------------------------------

DO $$
DECLARE
    v_quiz_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.quizzes WHERE class_number = 1) THEN
        INSERT INTO public.quizzes (
            class_number,
            title,
            description,
            scheduled_date,
            status,
            time_limit_minutes,
            show_score_immediately,
            show_correct_answers
        )
        VALUES (
            1,
            'Class 01: Introduction to Database Management Systems',
            'Covers fundamental concepts of DBMS, metadata, relational models, and ANSI/SPARC architecture.',
            CURRENT_DATE,
            'published',
            10,
            true,
            true
        )
        RETURNING id INTO v_quiz_id;

        INSERT INTO public.questions (quiz_id, question_text, question_type, options, correct_option, marks, order_index)
        VALUES 
        (
            v_quiz_id,
            'What does DBMS stand for?',
            'single_choice',
            '[{"id": "A", "text": "Database Management System"}, {"id": "B", "text": "Data Backup and Maintenance Software"}, {"id": "C", "text": "Digital Base Model System"}, {"id": "D", "text": "Distributed Binary Management Schema"}]'::JSONB,
            'A',
            1.00,
            1
        ),
        (
            v_quiz_id,
            'In database terminology, what is "metadata"?',
            'single_choice',
            '[{"id": "A", "text": "Unprocessed raw user input"}, {"id": "B", "text": "Data describing other data (system catalog)"}, {"id": "C", "text": "Backup copies of the database files"}, {"id": "D", "text": "Encrypted network traffic"}]'::JSONB,
            'B',
            1.00,
            2
        ),
        (
            v_quiz_id,
            'Which component represents the primary structure for organizing data in a Relational Database?',
            'single_choice',
            '[{"id": "A", "text": "Graph Trees"}, {"id": "B", "text": "Binary Heaps"}, {"id": "C", "text": "Two-dimensional Tables (Relations)"}, {"id": "D", "text": "Linked Lists"}]'::JSONB,
            'C',
            1.00,
            3
        ),
        (
            v_quiz_id,
            'In the ANSI/SPARC 3-tier database architecture, which level is closest to the physical hardware storage?',
            'single_choice',
            '[{"id": "A", "text": "External Level (Views)"}, {"id": "B", "text": "Conceptual Level (Logical Schema)"}, {"id": "C", "text": "Internal Level (Physical Schema)"}, {"id": "D", "text": "User Application Level"}]'::JSONB,
            'C',
            1.00,
            4
        ),
        (
            v_quiz_id,
            'What does SQL stand for in relational databases?',
            'single_choice',
            '[{"id": "A", "text": "Structured Query Language"}, {"id": "B", "text": "Sequential Question Lookup"}, {"id": "C", "text": "Simple Queue Logic"}, {"id": "D", "text": "Standardized Quantum Layout"}]'::JSONB,
            'A',
            1.00,
            5
        );
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 7. SECURE STUDENT ATTEMPT REVIEW RPC
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_student_attempt_review(
    p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_student_id UUID := auth.uid();
    v_attempt RECORD;
    v_quiz RECORD;
    v_q RECORD;
    v_ans RECORD;
    v_review_list JSONB := '[]'::JSONB;
    v_is_teacher BOOLEAN;
    v_can_reveal_correct BOOLEAN;
BEGIN
    IF v_student_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
    END IF;

    v_is_teacher := public.is_teacher();

    SELECT * INTO v_attempt 
    FROM public.quiz_attempts 
    WHERE id = p_attempt_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Attempt not found.');
    END IF;

    IF NOT v_is_teacher AND v_attempt.student_id <> v_student_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized access to attempt review.');
    END IF;

    SELECT * INTO v_quiz 
    FROM public.quizzes 
    WHERE id = v_attempt.quiz_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Associated quiz not found.');
    END IF;

    v_can_reveal_correct := (v_is_teacher OR COALESCE(v_quiz.show_correct_answers, false));

    FOR v_q IN 
        SELECT id, marks, correct_option, question_text, options, order_index
        FROM public.questions 
        WHERE quiz_id = v_attempt.quiz_id 
        ORDER BY order_index ASC
    LOOP
        SELECT * INTO v_ans 
        FROM public.attempt_answers 
        WHERE attempt_id = p_attempt_id AND question_id = v_q.id;

        v_review_list := v_review_list || jsonb_build_object(
            'question_id', v_q.id,
            'order_index', v_q.order_index,
            'question_text', v_q.question_text,
            'options', v_q.options,
            'marks_possible', v_q.marks,
            'selected_option', v_ans.selected_option,
            'is_correct', COALESCE(v_ans.is_correct, false),
            'marks_awarded', COALESCE(v_ans.marks_awarded, 0.00),
            'correct_option', CASE 
                WHEN v_can_reveal_correct THEN v_q.correct_option 
                ELSE NULL 
            END
        );
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'attempt', jsonb_build_object(
            'id', v_attempt.id,
            'score', v_attempt.score,
            'total_marks', v_attempt.total_marks,
            'submitted_at', v_attempt.submitted_at,
            'show_score_immediately', v_quiz.show_score_immediately,
            'show_correct_answers', v_quiz.show_correct_answers,
            'quiz', jsonb_build_object(
                'id', v_quiz.id,
                'class_number', v_quiz.class_number,
                'title', v_quiz.title,
                'scheduled_date', v_quiz.scheduled_date
            )
        ),
        'questions', v_review_list
    );
END;
$$;

