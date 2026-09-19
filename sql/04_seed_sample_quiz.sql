-- ==============================================================================
-- 04_seed_sample_quiz.sql: Sample Class 01 Quiz for Testing
-- Run this in Supabase SQL Editor to have an active quiz ready right away!
-- ==============================================================================

DO $$
DECLARE
    v_quiz_id UUID;
    v_existing_attempts INT;
BEGIN
    -- Check if Class 01 quiz already exists
    SELECT id INTO v_quiz_id FROM public.quizzes WHERE class_number = 1;

    IF v_quiz_id IS NOT NULL THEN
        SELECT count(*) INTO v_existing_attempts FROM public.quiz_attempts WHERE quiz_id = v_quiz_id;
        RAISE NOTICE 'Class 01 quiz already exists (ID: %) with % attempt(s). Skipping insert.', v_quiz_id, v_existing_attempts;
        RETURN;
    END IF;

    -- 1. Insert Sample Class 01 Quiz (Published)
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
        'Covers the fundamental concepts of DBMS, metadata, relational models, and architecture levels.',
        CURRENT_DATE,
        'published',
        10,
        true,
        true
    )
    RETURNING id INTO v_quiz_id;

    -- 2. Insert Question 1
    INSERT INTO public.questions (quiz_id, question_text, question_type, options, correct_option, marks, order_index)
    VALUES (
        v_quiz_id,
        'What does DBMS stand for?',
        'single_choice',
        '[
            {"id": "A", "text": "Database Management System"},
            {"id": "B", "text": "Data Backup and Maintenance Software"},
            {"id": "C", "text": "Digital Base Model System"},
            {"id": "D", "text": "Distributed Binary Management Schema"}
        ]'::JSONB,
        'A',
        1.00,
        1
    );

    -- 3. Insert Question 2
    INSERT INTO public.questions (quiz_id, question_text, question_type, options, correct_option, marks, order_index)
    VALUES (
        v_quiz_id,
        'In database terminology, what is "metadata"?',
        'single_choice',
        '[
            {"id": "A", "text": "Unprocessed raw user input"},
            {"id": "B", "text": "Data describing other data (system catalog)"},
            {"id": "C", "text": "Backup copies of the database files"},
            {"id": "D", "text": "Encrypted network traffic"}
        ]'::JSONB,
        'B',
        1.00,
        2
    );

    -- 4. Insert Question 3
    INSERT INTO public.questions (quiz_id, question_text, question_type, options, correct_option, marks, order_index)
    VALUES (
        v_quiz_id,
        'Which component represents the primary structure for organizing data in a Relational Database?',
        'single_choice',
        '[
            {"id": "A", "text": "Graph Trees"},
            {"id": "B", "text": "Binary Heaps"},
            {"id": "C", "text": "Two-dimensional Tables (Relations)"},
            {"id": "D", "text": "Linked Lists"}
        ]'::JSONB,
        'C',
        1.00,
        3
    );

    -- 5. Insert Question 4
    INSERT INTO public.questions (quiz_id, question_text, question_type, options, correct_option, marks, order_index)
    VALUES (
        v_quiz_id,
        'In the ANSI/SPARC 3-tier database architecture, which level is closest to the physical hardware storage?',
        'single_choice',
        '[
            {"id": "A", "text": "External Level (Views)"},
            {"id": "B", "text": "Conceptual Level (Logical Schema)"},
            {"id": "C", "text": "Internal Level (Physical Schema)"},
            {"id": "D", "text": "User Application Level"}
        ]'::JSONB,
        'C',
        1.00,
        4
    );

    -- 6. Insert Question 5
    INSERT INTO public.questions (quiz_id, question_text, question_type, options, correct_option, marks, order_index)
    VALUES (
        v_quiz_id,
        'What does SQL stand for in relational databases?',
        'single_choice',
        '[
            {"id": "A", "text": "Structured Query Language"},
            {"id": "B", "text": "Sequential Question Lookup"},
            {"id": "C", "text": "Simple Queue Logic"},
            {"id": "D", "text": "Standardized Quantum Layout"}
        ]'::JSONB,
        'A',
        1.00,
        5
    );

    RAISE NOTICE 'Sample Class 01 quiz created with ID: %', v_quiz_id;
END $$;
