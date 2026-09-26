-- ==============================================================================
-- DailyClassQuiz — complete database setup (multi-teacher, multi-course)
-- ==============================================================================
-- Paste this whole file into Supabase → SQL Editor → Run.
--
-- * Safe to run more than once.
-- * Also upgrades a database created by the older single-course scripts:
--   existing quizzes are moved into one course owned by the first teacher
--   account and every existing student is enrolled in it.
-- * The last statement prints the FACULTY SIGN-UP CODE. Share it only with
--   teachers — anyone who has it can register a teacher account.
-- * Everything that runs with elevated rights (SECURITY DEFINER) lives in the
--   `private` schema, which the Supabase API does not expose. `public` holds
--   only tables and SECURITY INVOKER entry points, so the Security Advisor
--   stays clean. Put new privileged functions in `private` too.
-- ==============================================================================


-- ------------------------------------------------------------------------------
-- 0. UTILITIES THAT TABLE DEFAULTS DEPEND ON
-- ------------------------------------------------------------------------------

-- Not in "Exposed schemas" (API settings), so nothing here is callable over REST.
-- Policies and the public wrappers still call into it with the caller's rights.
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO anon, authenticated;

-- Short human-friendly code (no 0/O/1/I) used for course join codes.
CREATE OR REPLACE FUNCTION public.generate_join_code(p_length INT DEFAULT 6)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
    alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    result TEXT := '';
BEGIN
    FOR i IN 1..p_length LOOP
        result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::INT, 1);
    END LOOP;
    RETURN result;
END;
$$;


-- ------------------------------------------------------------------------------
-- 1. TABLES
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'teacher', 'admin')),
    full_name TEXT NOT NULL,
    student_id TEXT UNIQUE,             -- college roll / registration number (students only)
    section TEXT,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS section TEXT;
ALTER TABLE public.profiles ALTER COLUMN section DROP DEFAULT;

-- Private key/value settings. RLS is on with no policies, so clients can never read it.
CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT INTO public.app_settings (key, value)
VALUES ('faculty_signup_code', public.generate_join_code(4) || '-' || public.generate_join_code(4) || '-' || public.generate_join_code(4))
ON CONFLICT (key) DO NOTHING;

-- A course (subject) taught by one teacher. Students join with join_code.
CREATE TABLE IF NOT EXISTS public.courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    code TEXT NOT NULL,                  -- e.g. CS-301
    name TEXT NOT NULL,                  -- e.g. Database Management Systems
    section TEXT,
    term TEXT,                           -- e.g. Spring 2026
    join_code TEXT NOT NULL UNIQUE DEFAULT public.generate_join_code(6),
    planned_classes INT NOT NULL DEFAULT 35 CHECK (planned_classes BETWEEN 1 AND 300),
    final_weight NUMERIC(6, 2) CHECK (final_weight IS NULL OR final_weight > 0),  -- quiz marks out of N in the final grade
    is_archived BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.enrollments (
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (course_id, student_id)
);

CREATE TABLE IF NOT EXISTS public.quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    class_number INT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    scheduled_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
    time_limit_minutes INT CHECK (time_limit_minutes IS NULL OR time_limit_minutes > 0),
    closes_at TIMESTAMPTZ,               -- optional automatic close time
    show_score_immediately BOOLEAN NOT NULL DEFAULT true,
    show_correct_answers BOOLEAN NOT NULL DEFAULT false,
    total_marks NUMERIC(6, 2) NOT NULL DEFAULT 0,   -- maintained by trigger
    question_count INT NOT NULL DEFAULT 0,          -- maintained by trigger
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Upgrade path for databases created by the single-course scripts
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE;
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS closes_at TIMESTAMPTZ;
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS total_marks NUMERIC(6, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS question_count INT NOT NULL DEFAULT 0;
ALTER TABLE public.quizzes DROP CONSTRAINT IF EXISTS unique_class_number;
ALTER TABLE public.quizzes DROP CONSTRAINT IF EXISTS quizzes_class_number_check;
ALTER TABLE public.quizzes ADD CONSTRAINT quizzes_class_number_check CHECK (class_number BETWEEN 1 AND 300);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quizzes_course_class_unique') THEN
        ALTER TABLE public.quizzes ADD CONSTRAINT quizzes_course_class_unique UNIQUE (course_id, class_number);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL DEFAULT 'single_choice' CHECK (question_type IN ('single_choice', 'true_false')),
    options JSONB NOT NULL,              -- [{ "id": "A", "text": "..." }, ...]
    correct_option TEXT NOT NULL,        -- never exposed to students
    marks NUMERIC(4, 2) NOT NULL DEFAULT 1.00 CHECK (marks > 0),
    order_index INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('in_progress', 'submitted', 'abandoned')),
    score NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    total_marks NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_student_quiz_attempt UNIQUE (quiz_id, student_id),
    CONSTRAINT chk_score_range CHECK (score >= 0 AND score <= total_marks)
);

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

CREATE INDEX IF NOT EXISTS idx_courses_teacher ON public.courses(teacher_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON public.enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_course ON public.quizzes(course_id, class_number);
CREATE INDEX IF NOT EXISTS idx_quizzes_status_date ON public.quizzes(status, scheduled_date DESC);
CREATE INDEX IF NOT EXISTS idx_questions_quiz_order ON public.questions(quiz_id, order_index);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student ON public.quiz_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz ON public.quiz_attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_attempt_answers_attempt ON public.attempt_answers(attempt_id);
DROP INDEX IF EXISTS public.idx_quizzes_class_number;


-- ------------------------------------------------------------------------------
-- 3. UPGRADE EXISTING SINGLE-COURSE DATA
-- ------------------------------------------------------------------------------

DO $$
DECLARE
    v_teacher UUID;
    v_course UUID;
BEGIN
    IF EXISTS (SELECT 1 FROM public.quizzes WHERE course_id IS NULL) THEN
        SELECT id INTO v_teacher
        FROM public.profiles
        WHERE role IN ('teacher', 'admin')
        ORDER BY created_at
        LIMIT 1;

        IF v_teacher IS NULL THEN
            RAISE NOTICE 'Quizzes without a course were found, but no teacher account exists yet. Register a teacher, then run this script again to import them.';
        ELSE
            INSERT INTO public.courses (teacher_id, code, name)
            VALUES (v_teacher, 'CS-301', 'Database Management Systems')
            RETURNING id INTO v_course;

            UPDATE public.quizzes SET course_id = v_course WHERE course_id IS NULL;

            INSERT INTO public.enrollments (course_id, student_id)
            SELECT v_course, id FROM public.profiles WHERE role = 'student'
            ON CONFLICT DO NOTHING;

            RAISE NOTICE 'Imported existing quizzes into course CS-301 and enrolled all existing students.';
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.quizzes WHERE course_id IS NULL) THEN
        ALTER TABLE public.quizzes ALTER COLUMN course_id SET NOT NULL;
    END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 4. HELPER FUNCTIONS (SECURITY DEFINER so policies never recurse through RLS)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.is_teacher()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin'));
$$;

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION private.owns_course(p_course_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.courses WHERE id = p_course_id AND teacher_id = auth.uid())
        OR private.is_admin();
$$;

CREATE OR REPLACE FUNCTION private.is_enrolled(p_course_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.enrollments WHERE course_id = p_course_id AND student_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION private.quiz_course_id(p_quiz_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT course_id FROM public.quizzes WHERE id = p_quiz_id;
$$;

CREATE OR REPLACE FUNCTION private.quiz_has_attempts(p_quiz_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.quiz_attempts WHERE quiz_id = p_quiz_id);
$$;

CREATE OR REPLACE FUNCTION private.course_has_attempts(p_course_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.quiz_attempts a
        JOIN public.quizzes z ON z.id = a.quiz_id
        WHERE z.course_id = p_course_id
    );
$$;

-- Teacher of at least one course the student is enrolled in
CREATE OR REPLACE FUNCTION private.teaches_student(p_student_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.enrollments e
        JOIN public.courses c ON c.id = e.course_id
        WHERE e.student_id = p_student_id AND c.teacher_id = auth.uid()
    );
$$;

-- Student is enrolled in at least one course taught by this teacher
CREATE OR REPLACE FUNCTION private.is_my_teacher(p_teacher_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.courses c
        JOIN public.enrollments e ON e.course_id = c.id
        WHERE c.teacher_id = p_teacher_id AND e.student_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION private.can_view_attempt(p_attempt_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.quiz_attempts a
        JOIN public.quizzes z ON z.id = a.quiz_id
        WHERE a.id = p_attempt_id AND private.owns_course(z.course_id)
    );
$$;

-- A quiz is closed when the teacher closes it or its automatic close time has passed
CREATE OR REPLACE FUNCTION private.quiz_is_closed(p_status TEXT, p_closes_at TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT p_status = 'closed' OR (p_closes_at IS NOT NULL AND now() > p_closes_at);
$$;


-- ------------------------------------------------------------------------------
-- 5. TRIGGERS
-- ------------------------------------------------------------------------------

-- 5a. Create a profile for every new auth user.
--     Teachers sign up with account_type = 'teacher' and the faculty code;
--     without a valid code the account is created as a student.
CREATE OR REPLACE FUNCTION private.verify_faculty_code(p_code TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.app_settings
        WHERE key = 'faculty_signup_code' AND upper(value) = upper(trim(coalesce(p_code, '')))
    );
$$;

CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meta JSONB := coalesce(NEW.raw_user_meta_data, '{}'::JSONB);
    v_role TEXT := 'student';
    v_student_id TEXT := nullif(trim(v_meta->>'student_id'), '');
BEGIN
    IF v_meta->>'account_type' = 'teacher' AND private.verify_faculty_code(v_meta->>'faculty_code') THEN
        v_role := 'teacher';
        v_student_id := NULL;
    END IF;

    INSERT INTO public.profiles (id, role, full_name, student_id, section, email)
    VALUES (
        NEW.id,
        v_role,
        coalesce(nullif(trim(v_meta->>'full_name'), ''), split_part(NEW.email, '@', 1)),
        v_student_id,
        nullif(trim(v_meta->>'section'), ''),
        NEW.email
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();

-- 5b. Users may edit their name and section, never their role, email or roll number.
--     (Admins and the SQL editor can change anything.)
CREATE OR REPLACE FUNCTION private.protect_profile_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at := now();
    IF auth.uid() IS NULL OR private.is_admin() THEN
        RETURN NEW;
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.student_id IS DISTINCT FROM OLD.student_id THEN
        RAISE EXCEPTION 'Only your name and section can be changed. Ask an administrator to update other details.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_fields
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION private.protect_profile_fields();

-- 5c. Keep quizzes.total_marks / question_count in sync with the questions table.
CREATE OR REPLACE FUNCTION private.recalc_quiz_totals(p_quiz_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE public.quizzes
    SET total_marks = coalesce((SELECT sum(marks) FROM public.questions WHERE quiz_id = p_quiz_id), 0),
        question_count = (SELECT count(*) FROM public.questions WHERE quiz_id = p_quiz_id)
    WHERE id = p_quiz_id;
$$;

CREATE OR REPLACE FUNCTION private.sync_quiz_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM private.recalc_quiz_totals(OLD.quiz_id);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM private.recalc_quiz_totals(NEW.quiz_id);
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_quiz_totals ON public.questions;
CREATE TRIGGER trg_sync_quiz_totals
    AFTER INSERT OR UPDATE OR DELETE ON public.questions
    FOR EACH ROW EXECUTE FUNCTION private.sync_quiz_totals();

-- Backfill totals for existing quizzes
UPDATE public.quizzes z
SET total_marks = coalesce((SELECT sum(marks) FROM public.questions q WHERE q.quiz_id = z.id), 0),
    question_count = (SELECT count(*) FROM public.questions q WHERE q.quiz_id = z.id);


-- ------------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- ------------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_answers ENABLE ROW LEVEL SECURITY;

-- Drop every existing policy on these tables (including ones from older scripts)
-- so no stale, broader policy survives. Policies are recreated below.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT policyname, tablename FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('profiles', 'app_settings', 'courses', 'enrollments',
                            'quizzes', 'questions', 'quiz_attempts', 'attempt_answers')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- profiles: yourself, your students, your teachers; admins see everyone
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR private.is_admin() OR private.teaches_student(id) OR private.is_my_teacher(id));

CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid() OR private.is_admin())
WITH CHECK (id = auth.uid() OR private.is_admin());

-- courses
CREATE POLICY courses_select ON public.courses FOR SELECT TO authenticated
USING (teacher_id = auth.uid() OR private.is_admin() OR private.is_enrolled(id));

CREATE POLICY courses_insert ON public.courses FOR INSERT TO authenticated
WITH CHECK (private.is_teacher() AND teacher_id = auth.uid());

CREATE POLICY courses_update ON public.courses FOR UPDATE TO authenticated
USING (teacher_id = auth.uid() OR private.is_admin())
WITH CHECK (teacher_id = auth.uid() OR private.is_admin());

CREATE POLICY courses_delete ON public.courses FOR DELETE TO authenticated
USING ((teacher_id = auth.uid() OR private.is_admin()) AND NOT private.course_has_attempts(id));

-- enrollments: students join through join_course(); teachers can remove students
CREATE POLICY enrollments_select ON public.enrollments FOR SELECT TO authenticated
USING (student_id = auth.uid() OR private.owns_course(course_id));

CREATE POLICY enrollments_delete ON public.enrollments FOR DELETE TO authenticated
USING (private.owns_course(course_id));

-- quizzes: owners see everything; enrolled students see published/closed quizzes
CREATE POLICY quizzes_select ON public.quizzes FOR SELECT TO authenticated
USING (private.owns_course(course_id) OR (status IN ('published', 'closed') AND private.is_enrolled(course_id)));

CREATE POLICY quizzes_insert ON public.quizzes FOR INSERT TO authenticated
WITH CHECK (private.owns_course(course_id));

CREATE POLICY quizzes_update ON public.quizzes FOR UPDATE TO authenticated
USING (private.owns_course(course_id))
WITH CHECK (private.owns_course(course_id));

CREATE POLICY quizzes_delete ON public.quizzes FOR DELETE TO authenticated
USING (private.owns_course(course_id) AND NOT private.quiz_has_attempts(id));

-- questions (with answer keys): course owner only. Students read public.student_questions.
CREATE POLICY questions_select ON public.questions FOR SELECT TO authenticated
USING (private.owns_course(private.quiz_course_id(quiz_id)));

CREATE POLICY questions_insert ON public.questions FOR INSERT TO authenticated
WITH CHECK (private.owns_course(private.quiz_course_id(quiz_id)) AND NOT private.quiz_has_attempts(quiz_id));

CREATE POLICY questions_update ON public.questions FOR UPDATE TO authenticated
USING (private.owns_course(private.quiz_course_id(quiz_id)) AND NOT private.quiz_has_attempts(quiz_id))
WITH CHECK (private.owns_course(private.quiz_course_id(quiz_id)));

CREATE POLICY questions_delete ON public.questions FOR DELETE TO authenticated
USING (private.owns_course(private.quiz_course_id(quiz_id)) AND NOT private.quiz_has_attempts(quiz_id));

-- quiz_attempts: created only by submit_quiz(). Teachers may delete one to allow a retake.
CREATE POLICY attempts_select ON public.quiz_attempts FOR SELECT TO authenticated
USING (student_id = auth.uid() OR private.owns_course(private.quiz_course_id(quiz_id)));

CREATE POLICY attempts_delete ON public.quiz_attempts FOR DELETE TO authenticated
USING (private.owns_course(private.quiz_course_id(quiz_id)));

-- attempt_answers: teachers only. Students review through get_student_attempt_review(),
-- which hides correctness until the quiz closes.
CREATE POLICY answers_select ON public.attempt_answers FOR SELECT TO authenticated
USING (private.can_view_attempt(attempt_id));

-- Student-safe question view (no correct_option). The private view reads questions
-- with owner rights on purpose and filters to quizzes the caller may take or owns;
-- the public view the app queries runs with the caller's rights on top of it.
DROP VIEW IF EXISTS public.student_questions;
DROP VIEW IF EXISTS private.student_questions;
CREATE VIEW private.student_questions WITH (security_barrier = true) AS
SELECT q.id, q.quiz_id, q.question_text, q.question_type, q.options, q.marks, q.order_index
FROM public.questions q
JOIN public.quizzes z ON z.id = q.quiz_id
WHERE (z.status IN ('published', 'closed') AND private.is_enrolled(z.course_id))
   OR private.owns_course(z.course_id);

CREATE VIEW public.student_questions WITH (security_invoker = true) AS
SELECT id, quiz_id, question_text, question_type, options, marks, order_index
FROM private.student_questions;

-- Remove the SECURITY DEFINER copies older scripts left in public. Nothing
-- depends on them any more: policies and triggers were recreated above.
DROP FUNCTION IF EXISTS
    public.is_teacher(), public.is_admin(), public.owns_course(UUID), public.is_enrolled(UUID),
    public.quiz_course_id(UUID), public.quiz_has_attempts(UUID), public.course_has_attempts(UUID),
    public.teaches_student(UUID), public.is_my_teacher(UUID), public.can_view_attempt(UUID),
    public.quiz_is_closed(TEXT, TIMESTAMPTZ), public.handle_new_user(), public.protect_profile_fields(),
    public.sync_quiz_totals(), public.recalc_quiz_totals(UUID);


-- ------------------------------------------------------------------------------
-- 7. RPC FUNCTIONS
-- ------------------------------------------------------------------------------
-- The privileged work happens in private.*; 7f exposes each one to the app
-- through a SECURITY INVOKER wrapper in public with the same name and arguments.

-- 7a. Anonymous pre-checks used by the registration form
CREATE OR REPLACE FUNCTION private.is_student_id_available(p_student_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT NOT EXISTS (SELECT 1 FROM public.profiles WHERE lower(student_id) = lower(trim(p_student_id)));
$$;

-- 7b. Student joins a course with its join code
CREATE OR REPLACE FUNCTION private.join_course(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_role TEXT;
    v_course public.courses%ROWTYPE;
    v_inserted INT;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Please sign in first.');
    END IF;

    SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
    IF v_role IS DISTINCT FROM 'student' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only student accounts can join a course.');
    END IF;

    SELECT * INTO v_course FROM public.courses
    WHERE join_code = upper(trim(coalesce(p_code, ''))) AND NOT is_archived;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'No active course has that code. Check it with your teacher.');
    END IF;

    INSERT INTO public.enrollments (course_id, student_id)
    VALUES (v_course.id, v_uid)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'already_enrolled', v_inserted = 0,
        'course_id', v_course.id,
        'course_code', v_course.code,
        'course_name', v_course.name
    );
END;
$$;

-- 7c. Grade a submission inside the database (answer keys never reach the browser)
CREATE OR REPLACE FUNCTION private.submit_quiz(p_quiz_id UUID, p_answers JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_quiz public.quizzes%ROWTYPE;
    v_attempt_id UUID;
    v_q RECORD;
    v_answers JSONB := CASE WHEN jsonb_typeof(p_answers) = 'array' THEN p_answers ELSE '[]'::JSONB END;
    v_total NUMERIC(6, 2) := 0;
    v_score NUMERIC(6, 2) := 0;
    v_selected TEXT;
    v_correct BOOLEAN;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Please sign in again.');
    END IF;

    SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
    IF NOT FOUND OR NOT private.is_enrolled(v_quiz.course_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Quiz not found, or you are not enrolled in its course.');
    END IF;

    -- one minute of grace so an auto-submit at the deadline is not rejected
    IF v_quiz.status <> 'published'
       OR (v_quiz.closes_at IS NOT NULL AND now() > v_quiz.closes_at + interval '1 minute') THEN
        RETURN jsonb_build_object('success', false, 'error', 'This quiz is closed and no longer accepts submissions.');
    END IF;

    BEGIN
        INSERT INTO public.quiz_attempts (quiz_id, student_id, status, score, total_marks)
        VALUES (p_quiz_id, v_uid, 'submitted', 0, 0)
        RETURNING id INTO v_attempt_id;
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'You have already submitted this quiz.');
    END;

    FOR v_q IN
        SELECT id, marks, correct_option FROM public.questions
        WHERE quiz_id = p_quiz_id ORDER BY order_index
    LOOP
        v_total := v_total + v_q.marks;

        SELECT left(ans->>'selected_option', 20) INTO v_selected
        FROM jsonb_array_elements(v_answers) ans
        WHERE ans->>'question_id' = v_q.id::TEXT
        LIMIT 1;

        v_correct := v_selected IS NOT NULL AND upper(trim(v_selected)) = upper(trim(v_q.correct_option));
        IF v_correct THEN
            v_score := v_score + v_q.marks;
        END IF;

        INSERT INTO public.attempt_answers (attempt_id, question_id, selected_option, is_correct, marks_awarded)
        VALUES (v_attempt_id, v_q.id, v_selected, v_correct, CASE WHEN v_correct THEN v_q.marks ELSE 0 END);
    END LOOP;

    UPDATE public.quiz_attempts
    SET score = v_score, total_marks = v_total, submitted_at = now()
    WHERE id = v_attempt_id;

    RETURN jsonb_build_object(
        'success', true,
        'attempt_id', v_attempt_id,
        'score', v_score,
        'total_marks', v_total,
        'percentage', CASE WHEN v_total > 0 THEN round(v_score / v_total * 100, 1) ELSE 0 END,
        'show_score_immediately', v_quiz.show_score_immediately
    );
END;
$$;

-- 7d. Question-by-question review of one attempt.
--     Students see correctness and the answer key only after the quiz closes,
--     and only if the teacher enabled "show correct answers". Teachers always see it.
CREATE OR REPLACE FUNCTION private.get_student_attempt_review(p_attempt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_attempt public.quiz_attempts%ROWTYPE;
    v_quiz public.quizzes%ROWTYPE;
    v_is_owner BOOLEAN;
    v_closed BOOLEAN;
    v_unlocked BOOLEAN;
    v_questions JSONB;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Please sign in again.');
    END IF;

    SELECT * INTO v_attempt FROM public.quiz_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Attempt not found.');
    END IF;

    SELECT * INTO v_quiz FROM public.quizzes WHERE id = v_attempt.quiz_id;
    v_is_owner := private.owns_course(v_quiz.course_id);

    IF NOT v_is_owner AND v_attempt.student_id <> v_uid THEN
        RETURN jsonb_build_object('success', false, 'error', 'You can only review your own attempts.');
    END IF;

    v_closed := private.quiz_is_closed(v_quiz.status, v_quiz.closes_at);
    v_unlocked := v_is_owner OR (v_quiz.show_correct_answers AND v_closed);

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'question_id', q.id,
            'order_index', q.order_index,
            'question_text', q.question_text,
            'options', q.options,
            'marks_possible', q.marks,
            'selected_option', a.selected_option,
            'is_correct', CASE WHEN v_unlocked THEN coalesce(a.is_correct, false) END,
            'marks_awarded', CASE WHEN v_unlocked THEN coalesce(a.marks_awarded, 0) END,
            'correct_option', CASE WHEN v_unlocked THEN q.correct_option END
        ) ORDER BY q.order_index
    ), '[]'::JSONB)
    INTO v_questions
    FROM public.questions q
    LEFT JOIN public.attempt_answers a ON a.question_id = q.id AND a.attempt_id = v_attempt.id
    WHERE q.quiz_id = v_quiz.id;

    RETURN jsonb_build_object(
        'success', true,
        'review_unlocked', v_unlocked,
        'quiz_closed', v_closed,
        'attempt', jsonb_build_object(
            'id', v_attempt.id,
            'score', v_attempt.score,
            'total_marks', v_attempt.total_marks,
            'submitted_at', v_attempt.submitted_at
        ),
        'quiz', jsonb_build_object(
            'id', v_quiz.id,
            'course_id', v_quiz.course_id,
            'class_number', v_quiz.class_number,
            'title', v_quiz.title,
            'scheduled_date', v_quiz.scheduled_date,
            'status', v_quiz.status,
            'closes_at', v_quiz.closes_at,
            'show_score_immediately', v_quiz.show_score_immediately,
            'show_correct_answers', v_quiz.show_correct_answers
        ),
        'questions', v_questions
    );
END;
$$;


-- 7e. Save a quiz and its questions in one transaction (runs with the caller's
--     rights, so the RLS policies above still apply). Questions are replaced
--     only while nobody has submitted the quiz.
CREATE OR REPLACE FUNCTION public.save_quiz(p_quiz JSONB, p_questions JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_id UUID := nullif(p_quiz->>'id', '')::UUID;
    v_course UUID := nullif(p_quiz->>'course_id', '')::UUID;
    v_status TEXT := coalesce(p_quiz->>'status', 'draft');
    v_locked BOOLEAN := false;
    v_q JSONB;
    v_idx INT := 0;
BEGIN
    IF v_course IS NULL OR NOT private.owns_course(v_course) THEN
        RAISE EXCEPTION 'You can only save quizzes in your own courses.';
    END IF;

    IF v_id IS NULL THEN
        INSERT INTO public.quizzes (
            course_id, class_number, title, description, scheduled_date, status,
            time_limit_minutes, closes_at, show_score_immediately, show_correct_answers, created_by
        ) VALUES (
            v_course,
            (p_quiz->>'class_number')::INT,
            trim(p_quiz->>'title'),
            nullif(trim(p_quiz->>'description'), ''),
            coalesce((p_quiz->>'scheduled_date')::DATE, CURRENT_DATE),
            v_status,
            nullif(p_quiz->>'time_limit_minutes', '')::INT,
            nullif(p_quiz->>'closes_at', '')::TIMESTAMPTZ,
            coalesce((p_quiz->>'show_score_immediately')::BOOLEAN, true),
            coalesce((p_quiz->>'show_correct_answers')::BOOLEAN, false),
            auth.uid()
        )
        RETURNING id INTO v_id;
    ELSE
        v_locked := private.quiz_has_attempts(v_id);
        UPDATE public.quizzes SET
            course_id = CASE WHEN v_locked THEN course_id ELSE v_course END,
            class_number = (p_quiz->>'class_number')::INT,
            title = trim(p_quiz->>'title'),
            description = nullif(trim(p_quiz->>'description'), ''),
            scheduled_date = coalesce((p_quiz->>'scheduled_date')::DATE, scheduled_date),
            status = v_status,
            time_limit_minutes = nullif(p_quiz->>'time_limit_minutes', '')::INT,
            closes_at = nullif(p_quiz->>'closes_at', '')::TIMESTAMPTZ,
            show_score_immediately = coalesce((p_quiz->>'show_score_immediately')::BOOLEAN, true),
            show_correct_answers = coalesce((p_quiz->>'show_correct_answers')::BOOLEAN, false),
            updated_at = now()
        WHERE id = v_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Quiz not found, or it belongs to another teacher.';
        END IF;
    END IF;

    IF NOT v_locked THEN
        DELETE FROM public.questions WHERE quiz_id = v_id;
        FOR v_q IN SELECT value FROM jsonb_array_elements(coalesce(p_questions, '[]'::JSONB)) LOOP
            v_idx := v_idx + 1;
            INSERT INTO public.questions (quiz_id, question_text, question_type, options, correct_option, marks, order_index)
            VALUES (
                v_id,
                trim(v_q->>'question_text'),
                coalesce(v_q->>'question_type', 'single_choice'),
                v_q->'options',
                v_q->>'correct_option',
                coalesce((v_q->>'marks')::NUMERIC, 1),
                v_idx
            );
        END LOOP;
    END IF;

    IF v_status <> 'draft' AND NOT EXISTS (SELECT 1 FROM public.questions WHERE quiz_id = v_id) THEN
        RAISE EXCEPTION 'Add at least one question before publishing.';
    END IF;

    RETURN jsonb_build_object('id', v_id, 'locked', v_locked);
END;
$$;

-- 7f. Public API wrappers. Dropped first because older scripts created these
--     names as SECURITY DEFINER functions with different argument names.
DROP FUNCTION IF EXISTS public.verify_faculty_code(TEXT);
CREATE FUNCTION public.verify_faculty_code(p_code TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.verify_faculty_code(p_code);
$$;

DROP FUNCTION IF EXISTS public.is_student_id_available(TEXT);
CREATE FUNCTION public.is_student_id_available(p_student_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.is_student_id_available(p_student_id);
$$;

DROP FUNCTION IF EXISTS public.join_course(TEXT);
CREATE FUNCTION public.join_course(p_code TEXT)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.join_course(p_code);
$$;

DROP FUNCTION IF EXISTS public.submit_quiz(UUID, JSONB);
CREATE FUNCTION public.submit_quiz(p_quiz_id UUID, p_answers JSONB)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.submit_quiz(p_quiz_id, p_answers);
$$;

DROP FUNCTION IF EXISTS public.get_student_attempt_review(UUID);
CREATE FUNCTION public.get_student_attempt_review(p_attempt_id UUID)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.get_student_attempt_review(p_attempt_id);
$$;


-- ------------------------------------------------------------------------------
-- 8. PRIVILEGES
-- ------------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Start from nothing, then grant exactly what the app uses (RLS still filters rows).
REVOKE ALL ON public.profiles, public.app_settings, public.courses, public.enrollments,
              public.quizzes, public.questions, public.quiz_attempts, public.attempt_answers,
              public.student_questions
FROM anon, authenticated;

GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.courses TO authenticated;
GRANT SELECT, DELETE ON public.enrollments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quizzes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.questions TO authenticated;
GRANT SELECT, DELETE ON public.quiz_attempts TO authenticated;
GRANT SELECT ON public.attempt_answers TO authenticated;
GRANT SELECT ON public.student_questions TO authenticated;
REVOKE ALL ON private.student_questions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON private.student_questions TO authenticated;

REVOKE ALL ON FUNCTION public.join_course(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_quiz(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_student_attempt_review(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_quiz(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_quiz(JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_course(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quiz(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_attempt_review(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_faculty_code(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_student_id_available(TEXT) TO anon, authenticated;

-- private.*: nobody by default (trigger functions need no grant to fire), then
-- exactly what RLS policies, the public wrappers and save_quiz call as the user.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    private.is_teacher(), private.is_admin(), private.owns_course(UUID), private.is_enrolled(UUID),
    private.quiz_course_id(UUID), private.quiz_has_attempts(UUID), private.course_has_attempts(UUID),
    private.teaches_student(UUID), private.is_my_teacher(UUID), private.can_view_attempt(UUID),
    private.join_course(TEXT), private.submit_quiz(UUID, JSONB), private.get_student_attempt_review(UUID)
TO authenticated;
GRANT EXECUTE ON FUNCTION private.verify_faculty_code(TEXT), private.is_student_id_available(TEXT)
TO anon, authenticated;

-- Let the API pick up the new and replaced functions straight away
NOTIFY pgrst, 'reload schema';


-- ------------------------------------------------------------------------------
-- 9. SHOW THE FACULTY SIGN-UP CODE
-- ------------------------------------------------------------------------------
-- To change it later:
--   UPDATE public.app_settings SET value = 'YOUR-NEW-CODE' WHERE key = 'faculty_signup_code';

SELECT value AS faculty_signup_code FROM public.app_settings WHERE key = 'faculty_signup_code';
