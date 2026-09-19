-- ==============================================================================
-- 03_rpc_grading.sql: Stored Procedures & Auth Triggers
-- Target Database: PostgreSQL 14+ (Supabase)
-- ==============================================================================

-- 1. Automatic Profile Creation on User Signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    user_role TEXT;
    s_id TEXT;
    f_name TEXT;
BEGIN
    -- Security: New signups are always 'student' by default.
    -- To grant 'teacher' or 'admin', update profiles manually in SQL editor.
    user_role := 'student';

    -- Extract metadata supplied during supabase.auth.signUp()
    f_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
    s_id := NEW.raw_user_meta_data->>'student_id';

    INSERT INTO public.profiles (id, role, full_name, student_id, email, created_at, updated_at)
    VALUES (
        NEW.id,
        user_role,
        f_name,
        s_id,
        NEW.email,
        now(),
        now()
    )
    ON CONFLICT (id) DO UPDATE
    SET 
        full_name = EXCLUDED.full_name,
        student_id = COALESCE(EXCLUDED.student_id, profiles.student_id),
        updated_at = now();

    RETURN NEW;
END;
$$;

-- Trigger to fire on auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ==============================================================================
-- 2. Anti-Cheat Server-Side Quiz Grading Function (RPC)
-- Evaluates submitted answers against actual correct_option in PostgreSQL.
-- The student's browser never sees correct answers prior to grading.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.submit_quiz(
    p_quiz_id UUID,
    p_answers JSONB -- Array: [{"question_id": "...", "selected_option": "A"}, ...]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_student_id UUID;
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
    -- 1. Verify caller authentication
    v_student_id := auth.uid();
    IF v_student_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
    END IF;

    -- 2. Verify quiz exists and is open for submissions
    SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Quiz not found.');
    END IF;

    IF v_quiz.status <> 'published' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This quiz is not currently accepting submissions.');
    END IF;

    -- 3. Verify student has not already attempted this quiz (1 attempt rule)
    IF EXISTS (SELECT 1 FROM public.quiz_attempts WHERE quiz_id = p_quiz_id AND student_id = v_student_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'You have already submitted an attempt for this quiz.');
    END IF;

    -- 4. Create the quiz attempt record
    INSERT INTO public.quiz_attempts (
        quiz_id,
        student_id,
        status,
        score,
        total_marks,
        started_at,
        submitted_at
    )
    VALUES (
        p_quiz_id,
        v_student_id,
        'submitted',
        0.00,
        0.00,
        now(),
        now()
    )
    RETURNING id INTO v_attempt_id;

    -- 5. Grade each question server-side
    FOR v_q IN 
        SELECT id, marks, correct_option, question_text, options 
        FROM public.questions 
        WHERE quiz_id = p_quiz_id
        ORDER BY order_index ASC
    LOOP
        v_total_marks := v_total_marks + v_q.marks;

        -- Extract student's answer for this question from p_answers JSON
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

        -- Record individual question answer
        INSERT INTO public.attempt_answers (
            attempt_id,
            question_id,
            selected_option,
            is_correct,
            marks_awarded,
            submitted_at
        )
        VALUES (
            v_attempt_id,
            v_q.id,
            v_user_ans,
            v_is_correct,
            v_awarded,
            now()
        );

        -- Build review breakdown if allowed
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

    -- 6. Update the attempt with final verified score
    UPDATE public.quiz_attempts
    SET 
        score = v_earned_score,
        total_marks = v_total_marks,
        submitted_at = now()
    WHERE id = v_attempt_id;

    -- 7. Return summary response to student
    RETURN jsonb_build_object(
        'success', true,
        'attempt_id', v_attempt_id,
        'quiz_id', p_quiz_id,
        'score', v_earned_score,
        'total_marks', v_total_marks,
        'percentage', CASE WHEN v_total_marks > 0 THEN ROUND((v_earned_score / v_total_marks) * 100, 1) ELSE 0 END,
        'show_score_immediately', v_quiz.show_score_immediately,
        'show_correct_answers', v_quiz.show_correct_answers,
        'review', CASE WHEN v_quiz.show_correct_answers THEN v_review_list ELSE NULL END
    );
END;
$$;


-- ==============================================================================
-- 3. Sample Seed Data (For Testing Class 01 Quiz)
-- Run this block after promoting your teacher account.
-- ==============================================================================
-- Example to promote an account to teacher (Replace with your teacher's email):
-- UPDATE public.profiles SET role = 'teacher' WHERE email = 'teacher@college.edu';
