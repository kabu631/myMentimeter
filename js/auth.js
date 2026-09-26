/**
 * ==============================================================================
 * js/auth.js - Student & Teacher Authentication, Route Guards, Navigation Bar
 * ==============================================================================
 * Pure Supabase Auth integration without server-side dependencies.
 * Roles live in public.profiles and are assigned by the database trigger:
 * a teacher account requires the faculty sign-up code (see sql/setup.sql).
 */

import { getSupabase, showToast } from './supabase.js';
import { sameClass } from './classes.js';
import { rootUrl, escapeHtml, friendlyError } from './utils.js';

export const isTeacherRole = (role) => role === 'teacher' || role === 'admin';

/** Landing page for a signed-in user. */
export function homeUrlFor(profile) {
  return rootUrl(isTeacherRole(profile?.role) ? 'admin/index.html' : 'dashboard.html');
}

/**
 * Register a student or teacher account.
 * Students give their roll number and the class they study in (they are then
 * enrolled in every subject of that class). Teachers give the faculty code and
 * the subjects they teach: [{ prefix, classChoice, name, code }], where
 * classChoice comes from readClassPicker() and prefix is the row's element-id
 * prefix (used to point errors at the right field).
 *
 * On failure `field` is either a logical name (fullName, studentId, classId,
 * email, password, facultyCode, subjects) or the id of a subject-row element.
 */
export async function registerUser({ accountType, fullName, studentId, classId, email, password, facultyCode, subjects = [] }) {
  const supabase = getSupabase();
  if (!supabase) {
    return { success: false, error: 'Database client is not initialized.' };
  }

  const isTeacher = accountType === 'teacher';
  const trimmedName = (fullName || '').trim();
  const trimmedId = (studentId || '').trim();
  const trimmedEmail = (email || '').trim().toLowerCase();
  const trimmedCode = (facultyCode || '').trim();

  if (trimmedName.length < 2) {
    return { success: false, field: 'fullName', error: 'Please enter your full name (at least 2 characters).' };
  }
  if (!isTeacher && trimmedId.length < 2) {
    return { success: false, field: 'studentId', error: 'Please enter your college roll / registration number.' };
  }
  if (!isTeacher && !classId) {
    return { success: false, field: 'classId', error: 'Please choose the class you study in.' };
  }
  if (isTeacher && !trimmedCode) {
    return { success: false, field: 'facultyCode', error: 'Please enter the faculty sign-up code from your administrator.' };
  }

  // Teachers: every subject needs a class and a name, with no repeats
  const cleanSubjects = [];
  if (isTeacher) {
    if (subjects.length === 0) {
      return { success: false, field: 'subjects', error: 'Add at least one subject you teach.' };
    }
    for (const s of subjects) {
      if (s.classChoice.error) return { success: false, field: s.classChoice.field, error: s.classChoice.error };
      const name = (s.name || '').trim().replace(/\s+/g, ' ');
      if (name.length < 2) {
        return { success: false, field: `${s.prefix}-name`, error: 'Enter the subject name, such as Computer Applications.' };
      }
      const repeat = cleanSubjects.find(c => c.name.toUpperCase() === name.toUpperCase() && sameClass(c.classChoice, s.classChoice));
      if (repeat) {
        return { success: false, field: `${s.prefix}-name`, error: 'You have already added this subject for this class.' };
      }
      cleanSubjects.push({ ...s, name, code: (s.code || '').trim() });
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return { success: false, field: 'email', error: 'Please enter a valid email address, like name@college.edu.' };
  }
  if (!password || password.length < 6) {
    return { success: false, field: 'password', error: 'Password must be at least 6 characters long.' };
  }

  try {
    // Pre-checks give clear messages before the account is created
    if (isTeacher) {
      const { data: codeOk, error } = await supabase.rpc('verify_faculty_code', { p_code: trimmedCode });
      if (error) throw error;
      if (!codeOk) {
        return { success: false, field: 'facultyCode', error: 'That faculty sign-up code is not valid. Check it with your administrator.' };
      }
      for (const s of cleanSubjects.filter(x => x.classChoice.classId)) {
        const { data: taken, error: takenErr } = await supabase.rpc('is_subject_taken', { p_class_id: s.classChoice.classId, p_name: s.name });
        if (takenErr) throw takenErr;
        if (taken) {
          return {
            success: false, field: `${s.prefix}-name`,
            error: `This class already has a subject called "${s.name}". If you teach it, check with your administrator; otherwise use a more specific name.`
          };
        }
      }
    } else {
      const { data: idFree, error } = await supabase.rpc('is_student_id_available', { p_student_id: trimmedId });
      if (error) throw error;
      if (!idFree) {
        return { success: false, field: 'studentId', error: `Roll number "${trimmedId}" is already registered. Sign in instead, or check the number.` };
      }
    }

    const metadata = isTeacher
      ? {
          account_type: 'teacher', full_name: trimmedName, faculty_code: trimmedCode,
          subjects: cleanSubjects.map(s => ({
            class_id: s.classChoice.classId || null,
            program: s.classChoice.program || null,
            semester: s.classChoice.semester || null,
            section: s.classChoice.section || null,
            name: s.name,
            code: s.code || null
          }))
        }
      : { account_type: 'student', full_name: trimmedName, student_id: trimmedId, class_id: classId };

    const { data, error: authErr } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        data: metadata,
        emailRedirectTo: rootUrl('index.html')
      }
    });

    if (authErr) {
      if (authErr.message?.toLowerCase().includes('already registered')) {
        return { success: false, field: 'email', error: 'An account with this email already exists. Please sign in instead.' };
      }
      return { success: false, error: friendlyError(authErr) };
    }

    // With "Confirm email" enabled in Supabase, no session is returned until the link is clicked
    if (!data?.session) {
      return { success: true, needsConfirmation: true };
    }

    const profile = await getUserProfile();
    return { success: true, needsConfirmation: false, profile, redirectUrl: homeUrlFor(profile) };
  } catch (err) {
    console.error('Registration exception:', err);
    return { success: false, error: friendlyError(err) };
  }
}

/**
 * Authenticates a user (student or teacher) through Supabase Auth.
 */
export async function loginUser(email, password) {
  const supabase = getSupabase();
  if (!supabase) {
    return { success: false, error: 'Database client is not initialized.' };
  }

  const trimmedEmail = (email || '').trim().toLowerCase();
  if (!trimmedEmail || !password) {
    return { success: false, field: !trimmedEmail ? 'email' : 'password', error: !trimmedEmail ? 'Please enter your email address.' : 'Please enter your password.' };
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password });

    if (error) {
      const msg = error.message?.toLowerCase() || '';
      if (msg.includes('invalid login credentials')) {
        return { success: false, error: 'Incorrect email or password.' };
      }
      if (msg.includes('email not confirmed')) {
        return { success: false, error: 'Please confirm your email first — check your inbox (and spam folder) for the confirmation link.' };
      }
      return { success: false, error: friendlyError(error) };
    }

    if (!data?.user) {
      return { success: false, error: 'Login verification failed.' };
    }

    const profile = await getUserProfile();
    return {
      success: true,
      profile,
      isTeacher: isTeacherRole(profile?.role),
      redirectUrl: homeUrlFor(profile)
    };
  } catch (err) {
    console.error('Login exception:', err);
    return { success: false, error: friendlyError(err) };
  }
}

/**
 * Log out user, clear local state, and redirect to login page.
 */
export async function signOut() {
  const supabase = getSupabase();
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Sign out warning:', err);
    }
  }

  sessionStorage.clear();
  window.location.href = rootUrl('login.html');
}

/**
 * Fetch profile of currently authenticated user (null when signed out).
 */
export async function getUserProfile() {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return null;

    const fetchProfile = (columns) => supabase.from('profiles').select(columns).eq('id', user.id).maybeSingle();
    let { data: profile, error } = await fetchProfile('*, class:classes(id, program, semester, section)');
    if (error) {
      // e.g. the database has not been upgraded yet and has no classes table
      console.warn('Profile fetch note:', error);
      ({ data: profile } = await fetchProfile('*'));
    }

    // The trigger normally creates the row; fall back to a student view of auth metadata
    return profile || {
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name || user.email.split('@')[0],
      student_id: user.user_metadata?.student_id || null,
      class_id: null,
      class: null,
      role: 'student'
    };
  } catch (err) {
    console.error('Error fetching user profile:', err);
    return null;
  }
}

/**
 * Route Guard. requiredRole: 'student' | 'teacher' | null (any signed-in user).
 * Sends users to the login page, or to their own home if the page is for the other role.
 */
export async function requireAuth(requiredRole = null) {
  const supabase = getSupabase();
  if (!supabase) {
    document.body.insertAdjacentHTML('afterbegin',
      '<div class="alert alert-danger" style="margin: 1rem;">Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in js/config.js.</div>');
    return null;
  }

  const profile = await getUserProfile();
  if (!profile) {
    window.location.replace(rootUrl('login.html'));
    return null;
  }

  const teacher = isTeacherRole(profile.role);
  if ((requiredRole === 'teacher' && !teacher) || (requiredRole === 'student' && teacher)) {
    window.location.replace(homeUrlFor(profile));
    return null;
  }

  renderNavbar(profile);
  return profile;
}

/**
 * Fills the page's <nav class="navbar-nav"> with role-specific links, the user pill and Sign Out.
 */
export function renderNavbar(profile) {
  const nav = document.querySelector('.navbar-nav');
  if (!nav) return;

  const teacher = isTeacherRole(profile.role);
  const links = teacher
    ? [
        ['admin/index.html', 'Subjects'],
        ['admin/quizzes.html', 'Quizzes'],
        ['admin/students.html', 'Students'],
        ['admin/results.html', 'Gradebook']
      ]
    : [
        ['dashboard.html', 'Dashboard'],
        ['results.html', 'Results'],
        ['profile.html', 'Profile']
      ];

  const here = window.location.pathname;
  const isActive = (path) => here.endsWith('/' + path) ||
    (path === 'admin/quizzes.html' && here.endsWith('/admin/create-quiz.html')) ||
    (path === 'admin/index.html' && here.endsWith('/admin/'));

  const roleBadge = profile.role === 'admin'
    ? '<span class="badge badge-primary">Admin</span>'
    : teacher
      ? '<span class="badge badge-primary">Teacher</span>'
      : '<span class="badge badge-published">Student</span>';

  nav.innerHTML = `
    ${links.map(([path, label]) =>
      `<a href="${rootUrl(path)}" class="nav-link ${isActive(path) ? 'active' : ''}">${label}</a>`
    ).join('')}
    <div class="user-pill">
      <div class="user-avatar">${escapeHtml((profile.full_name || 'U').charAt(0).toUpperCase())}</div>
      <span class="user-pill-name">${escapeHtml(profile.full_name || profile.email)}</span>
      ${roleBadge}
    </div>
    <button type="button" id="nav-logout-btn" class="btn btn-outline btn-sm">Sign Out</button>
  `;

  document.getElementById('nav-logout-btn')?.addEventListener('click', signOut);

  const brand = document.querySelector('.navbar-brand');
  if (brand && brand.tagName === 'A') brand.href = homeUrlFor(profile);
}

/**
 * Initiates the password recovery flow by sending a reset email.
 */
export async function sendPasswordResetEmail(email) {
  const supabase = getSupabase();
  if (!supabase) {
    return { success: false, error: 'Database client is not initialized.' };
  }

  const trimmedEmail = (email || '').trim().toLowerCase();
  if (!trimmedEmail) {
    return { success: false, error: 'Please enter your registered email address.' };
  }

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: rootUrl('reset-password.html')
    });
    if (error) {
      return { success: false, error: friendlyError(error) };
    }
    return { success: true };
  } catch (err) {
    console.error('Password reset request exception:', err);
    return { success: false, error: friendlyError(err) };
  }
}

/**
 * Updates the password for the current user (e.g. following a recovery redirect).
 */
export async function updateUserPassword(newPassword) {
  const supabase = getSupabase();
  if (!supabase) {
    return { success: false, error: 'Database client is not initialized.' };
  }

  if (!newPassword || newPassword.length < 6) {
    return { success: false, error: 'New password must be at least 6 characters long.' };
  }

  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) {
    console.error('Password update exception:', err);
    return { success: false, error: friendlyError(err) };
  }
}

/** Show a short toast and send the user somewhere after a delay. */
export function toastAndGo(message, url, type = 'success', delay = 600) {
  showToast(message, type);
  setTimeout(() => { window.location.href = url; }, delay);
}
