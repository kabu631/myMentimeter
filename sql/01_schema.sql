-- ==============================================================================
-- 01_schema.sql: Relational Schema for Student Daily Quiz System
-- Target Database: PostgreSQL 14+ (Supabase)
-- ==============================================================================

-- 1. Profiles Table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'teacher', 'admin')),
    full_name TEXT NOT NULL,
    student_id TEXT UNIQUE, -- College Roll Number / Registration Number (Nullable for teachers)
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Quizzes Table (Belongs to a class/session)
CREATE TABLE IF NOT EXISTS public.quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_number INT NOT NULL, -- e.g., Class 01 to 35
    title TEXT NOT NULL,       -- e.g., "Introduction to DBMS"
    description TEXT,
    scheduled_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
    time_limit_minutes INT DEFAULT NULL, -- NULL means untimed
    show_score_immediately BOOLEAN NOT NULL DEFAULT true,
    show_correct_answers BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Questions Table
CREATE TABLE IF NOT EXISTS public.questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL DEFAULT 'single_choice' CHECK (question_type IN ('single_choice', 'true_false')),
    options JSONB NOT NULL, -- Array of objects: [{"id": "A", "text": "Option 1"}, {"id": "B", "text": "Option 2"}, ...]
    correct_option TEXT NOT NULL, -- e.g., 'A', 'B', 'C', 'D' (Protected from students)
    marks NUMERIC(4, 2) NOT NULL DEFAULT 1.00 CHECK (marks > 0),
    order_index INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Quiz Attempts Table
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('in_progress', 'submitted', 'abandoned')),
    score NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    total_marks NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Enforce rule: each student can only attempt a quiz once
    CONSTRAINT unique_student_quiz_attempt UNIQUE (quiz_id, student_id)
);

-- 5. Attempt Answers Table (stores individual question submissions)
CREATE TABLE IF NOT EXISTS public.attempt_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    selected_option TEXT, -- e.g., 'A' (or NULL if skipped)
    is_correct BOOLEAN NOT NULL DEFAULT false,
    marks_awarded NUMERIC(4, 2) NOT NULL DEFAULT 0.00,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Enforce rule: one recorded answer per question per attempt
    CONSTRAINT unique_attempt_question UNIQUE (attempt_id, question_id)
);

-- ==============================================================================
-- INDEXES FOR PERFORMANCE
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_quizzes_status_date ON public.quizzes(status, scheduled_date DESC);
CREATE INDEX IF NOT EXISTS idx_quizzes_class_number ON public.quizzes(class_number ASC);
CREATE INDEX IF NOT EXISTS idx_questions_quiz_order ON public.questions(quiz_id, order_index ASC);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student ON public.quiz_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz ON public.quiz_attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_attempt_answers_attempt ON public.attempt_answers(attempt_id);
