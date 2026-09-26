-- ==============================================================================
-- Security Advisor hotfix for the CURRENT (single-course) database
-- ==============================================================================
-- Paste this whole file into Supabase → SQL Editor → Run. Safe to run more than once.
-- The result panel should show one row: "OK - no database security findings left".
--
-- Fixes every database finding in Advisors → Security Advisor without changing any
-- table or anything the live site calls:
--   * student_questions: "Security Definer View" (it was readable without signing in)
--   * is_teacher, handle_new_user, submit_quiz, get_student_attempt_review:
--     "Public / Signed-In Users Can Execute SECURITY DEFINER Function"
--   * is_teacher: "Function Search Path Mutable"
--
-- How: those objects move to a `private` schema that the API does not expose.
-- Policies, the view and the signup trigger follow them automatically (Postgres
-- tracks them by id, not by name). The site keeps calling public.submit_quiz and
-- public.get_student_attempt_review, which become SECURITY INVOKER wrappers.
--
-- sql/setup.sql (the multi-course upgrade) builds on this state when you run it later.
-- "Leaked Password Protection Disabled" is an Auth setting, not SQL: turn on
-- "Prevent use of leaked passwords" in Authentication settings.
-- ==============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO anon, authenticated;


-- 1. Move the SECURITY DEFINER functions out of the API schema.
DO $$
DECLARE
    v_fn TEXT;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY['is_teacher()', 'handle_new_user()', 'submit_quiz(uuid, jsonb)', 'get_student_attempt_review(uuid)'] LOOP
        -- Only the old SECURITY DEFINER version moves; on a re-run public holds the wrapper.
        IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.' || v_fn) AND prosecdef) THEN
            IF to_regprocedure('private.' || v_fn) IS NOT NULL THEN
                RAISE EXCEPTION 'Both public.% and private.% exist. Nothing was changed; ask for help before running this again.', v_fn, v_fn;
            END IF;
            EXECUTE 'ALTER FUNCTION public.' || v_fn || ' SET SCHEMA private';
        END IF;
    END LOOP;
END $$;

-- 2. Pin search_path on every private function that lacks one (is_teacher did).
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS fn
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'private'
          AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) cfg WHERE cfg LIKE 'search_path=%')
    LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.fn);
    END LOOP;
END $$;

-- 3. Function bodies look up names when they run, so calls written as
--    public.is_teacher() / is_teacher() inside them must now say private.is_teacher().
DO $$
DECLARE
    r RECORD;
    v_def TEXT;
BEGIN
    FOR r IN
        SELECT p.oid
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'private')
          AND p.proname <> 'is_teacher'
          AND p.prosrc ~ 'public\.is_teacher\(|(?<![\w.])is_teacher\('
    LOOP
        v_def := pg_get_functiondef(r.oid);
        EXECUTE regexp_replace(v_def, 'public\.is_teacher\(|(?<![\w.])is_teacher\(', 'private.is_teacher(', 'g');
    END LOOP;
END $$;


-- 4. Question view: the owner-rights view moves to private (keeping its exact
--    filter), and the app reads a caller-rights view on top of it.
DO $$
BEGIN
    IF to_regclass('private.student_questions') IS NULL THEN
        ALTER VIEW public.student_questions SET SCHEMA private;
    END IF;
END $$;
ALTER VIEW private.student_questions SET (security_barrier = true);

DROP VIEW IF EXISTS public.student_questions;
CREATE VIEW public.student_questions WITH (security_invoker = true) AS
SELECT * FROM private.student_questions;


-- 5. Public API wrappers with the same names and arguments the site already uses.
CREATE OR REPLACE FUNCTION public.submit_quiz(p_quiz_id UUID, p_answers JSONB)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.submit_quiz(p_quiz_id, p_answers);
$$;

CREATE OR REPLACE FUNCTION public.get_student_attempt_review(p_attempt_id UUID)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.get_student_attempt_review(p_attempt_id);
$$;


-- 6. Privileges. Signed-out visitors get nothing; signed-in users get exactly what
--    the RLS policies and the wrappers call. Trigger functions need no grant to fire.
REVOKE ALL ON public.student_questions, private.student_questions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.student_questions, private.student_questions TO authenticated;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    private.is_teacher(), private.submit_quiz(UUID, JSONB), private.get_student_attempt_review(UUID)
TO authenticated;

REVOKE ALL ON FUNCTION public.submit_quiz(UUID, JSONB), public.get_student_attempt_review(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_quiz(UUID, JSONB), public.get_student_attempt_review(UUID) TO authenticated;

-- Let the API pick up the new functions and view straight away
NOTIFY pgrst, 'reload schema';

COMMIT;


-- 7. Self-check: the same rules the Security Advisor applies to the database.
WITH findings AS (
    SELECT 'Security Definer View: ' || c.relname AS finding
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
      AND NOT coalesce(c.reloptions && ARRAY['security_invoker=true', 'security_invoker=on'], false)
    UNION ALL
    SELECT 'Function Search Path Mutable: ' || n.nspname || '.' || p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f'
      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) cfg WHERE cfg LIKE 'search_path=%')
    UNION ALL
    SELECT 'SECURITY DEFINER callable over the API: ' || p.oid::regprocedure::TEXT
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
)
SELECT coalesce(string_agg(finding, E'\n'), 'OK - no database security findings left') AS result
FROM findings;
