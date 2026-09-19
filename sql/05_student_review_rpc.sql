-- ==============================================================================
-- 05_student_review_rpc.sql: Secure Student Quiz Review RPC
-- Target Database: PostgreSQL 14+ (Supabase)
-- 
-- Allows authenticated students to review their own completed quiz attempts,
-- including question prompts, options, their selected answers, marks awarded,
-- and the correct answers ONLY IF teacher configuration allows it (show_correct_answers = true).
-- 
-- Privacy Guarantee:
-- 1. Students can ONLY review their own attempts (student_id = auth.uid()).
-- 2. Never exposes answer key for unattempted quizzes.
-- 3. If teacher disabled answer reveal, correct_option is returned as NULL.
-- ==============================================================================

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
    -- 1. Must be logged in
    IF v_student_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
    END IF;

    v_is_teacher := public.is_teacher();

    -- 2. Locate Attempt Record
    SELECT * INTO v_attempt 
    FROM public.quiz_attempts 
    WHERE id = p_attempt_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Attempt not found.');
    END IF;

    -- 3. Privacy Check: Only attempt owner or teacher can retrieve answers
    IF NOT v_is_teacher AND v_attempt.student_id <> v_student_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized access to attempt review.');
    END IF;

    -- 4. Locate Quiz Record
    SELECT * INTO v_quiz 
    FROM public.quizzes 
    WHERE id = v_attempt.quiz_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Associated quiz not found.');
    END IF;

    -- Teacher setting check
    v_can_reveal_correct := (v_is_teacher OR COALESCE(v_quiz.show_correct_answers, false));

    -- 5. Build question-by-question breakdown
    FOR v_q IN 
        SELECT id, marks, correct_option, question_text, options, order_index
        FROM public.questions 
        WHERE quiz_id = v_attempt.quiz_id 
        ORDER BY order_index ASC
    LOOP
        -- Fetch student answer for this question
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
