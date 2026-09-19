-- ==============================================================================
-- create_super_admin.sql: Pre-configured Super Admin / Teacher Account
-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/uehufarldrbavngpefug/sql/new
--
-- Credentials generated:
-- Email:    admin@college.edu
-- Password: AdminPassword123!
-- Role:     teacher (Super Admin / Faculty)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
    v_user_id UUID;
    v_email TEXT := 'admin@college.edu';
    v_password TEXT := 'AdminPassword123!';
BEGIN
    -- 1. Check if user already exists in auth.users
    SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;

    IF v_user_id IS NULL THEN
        v_user_id := gen_random_uuid();
        
        -- Insert into auth.users
        INSERT INTO auth.users (
            instance_id,
            id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            raw_app_meta_data,
            raw_user_meta_data,
            created_at,
            updated_at,
            confirmation_token
        ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            v_user_id,
            'authenticated',
            'authenticated',
            v_email,
            crypt(v_password, gen_salt('bf')),
            now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            '{"full_name":"Super Admin","student_id":"FAC-001"}'::jsonb,
            now(),
            now(),
            ''
        );

        -- Insert into auth.identities for GoTrue compatibility
        INSERT INTO auth.identities (
            id,
            user_id,
            identity_data,
            provider,
            last_sign_in_at,
            created_at,
            updated_at
        ) VALUES (
            v_user_id::text,
            v_user_id,
            jsonb_build_object('sub', v_user_id::text, 'email', v_email),
            'email',
            now(),
            now(),
            now()
        )
        ON CONFLICT DO NOTHING;
    ELSE
        -- Update password and confirm email if user already exists
        UPDATE auth.users 
        SET encrypted_password = crypt(v_password, gen_salt('bf')),
            email_confirmed_at = COALESCE(email_confirmed_at, now()),
            updated_at = now()
        WHERE id = v_user_id;
    END IF;

    -- 2. Insert or update role in public.profiles
    INSERT INTO public.profiles (
        id, 
        role, 
        full_name, 
        student_id, 
        section, 
        email, 
        created_at, 
        updated_at
    )
    VALUES (
        v_user_id, 
        'teacher', 
        'Super Admin', 
        'FAC-001', 
        'Faculty', 
        v_email, 
        now(), 
        now()
    )
    ON CONFLICT (id) DO UPDATE
    SET 
        role = 'teacher',
        full_name = 'Super Admin',
        updated_at = now();

    RAISE NOTICE '=======================================================';
    RAISE NOTICE 'SUPER ADMIN CREATED / UPDATED SUCCESSFULLY!';
    RAISE NOTICE 'Email:    %', v_email;
    RAISE NOTICE 'Password: %', v_password;
    RAISE NOTICE 'Role:     teacher';
    RAISE NOTICE '=======================================================';
END $$;
