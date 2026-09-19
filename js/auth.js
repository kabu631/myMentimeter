/**
 * ==============================================================================
 * js/auth.js - Student & Instructor Authentication System
 * ==============================================================================
 * Pure Supabase Auth integration without server-side Node.js dependencies.
 * Never stores or exposes raw passwords in custom database tables.
 */

import { getSupabase, showToast } from './supabase.js';

/**
 * Register a new student account.
 * Collects Full Name, Student ID, Email, Password, and Section/Class.
 */
export async function registerStudent({ fullName, studentId, email, password, section }) {
  const supabase = getSupabase();
  if (!supabase) {
    return { success: false, error: 'Database client is not initialized.' };
  }

  // 1. Client-side Form Validations
  const trimmedName = (fullName || '').trim();
  const trimmedId = (studentId || '').trim();
  const trimmedEmail = (email || '').trim().toLowerCase();
  const trimmedSection = (section || '').trim();

  if (!trimmedName || trimmedName.length < 2) {
    return { success: false, error: 'Please provide a valid full name (at least 2 characters).' };
  }

  if (!trimmedId || trimmedId.length < 2) {
    return { success: false, error: 'Please provide your official college student roll or registration number.' };
  }

  if (!trimmedSection) {
    return { success: false, error: 'Please specify your class section (e.g. Section A, Section B).' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    return { success: false, error: 'Please provide a valid college email address.' };
  }

  if (!password || password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters long.' };
  }

  try {
    // 2. Check if the Student ID is already registered in profiles
    const { data: existingStudent } = await supabase
      .from('profiles')
      .select('student_id')
      .eq('student_id', trimmedId)
      .maybeSingle();

    if (existingStudent) {
      return {
        success: false,
        error: `Student ID "${trimmedId}" is already registered. Please check your roll number or log in.`
      };
    }

    // 3. Register user via Supabase Auth
    // User metadata stores student identity securely
    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email: trimmedEmail,
      password: password,
      options: {
        data: {
          full_name: trimmedName,
          student_id: trimmedId,
          section: trimmedSection,
          role: 'student'
        }
      }
    });

    if (authErr) {
      if (authErr.message?.toLowerCase().includes('already registered')) {
        return {
          success: false,
          error: 'An account with this email address already exists. Please log in instead.'
        };
      }
      return { success: false, error: authErr.message };
    }

    const user = authData?.user;
    if (!user) {
      return { success: false, error: 'User creation failed. Please try again.' };
    }

    // 4. Ensure profile row exists in public.profiles table
    // (The database trigger handles this automatically, but this upsert ensures section is saved)
    try {
      await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          role: 'student',
          full_name: trimmedName,
          student_id: trimmedId,
          email: trimmedEmail,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
    } catch (upsertErr) {
      console.warn('Profile sync note:', upsertErr);
    }

    return {
      success: true,
      user: user,
      redirectUrl: 'dashboard.html'
    };

  } catch (err) {
    console.error('Registration exception:', err);
    return { success: false, error: err.message || 'An unexpected error occurred during registration.' };
  }
}

/**
 * Authenticates a user (Student or Admin/Teacher) through Supabase Auth.
 */
export async function loginUser(email, password) {
  const supabase = getSupabase();
  if (!supabase) {
    return { success: false, error: 'Database client is not initialized.' };
  }

  const trimmedEmail = (email || '').trim().toLowerCase();

  if (!trimmedEmail || !password) {
    return { success: false, error: 'Please enter both your email address and password.' };
  }

  try {
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password: password
    });

    if (authErr) {
      if (authErr.message?.toLowerCase().includes('invalid login credentials')) {
        return { success: false, error: 'Incorrect email or password. Please verify your credentials.' };
      }
      return { success: false, error: authErr.message };
    }

    const user = authData?.user;
    if (!user) {
      return { success: false, error: 'Login verification failed.' };
    }

    // Retrieve the user profile to determine their role
    const profile = await getUserProfile();
    const role = profile?.role || user.user_metadata?.role || 'student';

    const isAdmin = (role === 'admin' || role === 'teacher');
    const redirectUrl = isAdmin ? 'admin/index.html' : 'dashboard.html';

    return {
      success: true,
      user: user,
      profile: profile,
      role: role,
      isAdmin: isAdmin,
      redirectUrl: redirectUrl
    };

  } catch (err) {
    console.error('Login exception:', err);
    return { success: false, error: err.message || 'An unexpected error occurred during login.' };
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
  window.location.href = 'login.html';
}

/**
 * Fetch profile of currently authenticated user.
 */
export async function getUserProfile() {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return null;

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.warn('Profile fetch note:', error);
    }

    if (!profile) {
      // Fallback from auth metadata
      return {
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || user.email.split('@')[0],
        student_id: user.user_metadata?.student_id || 'N/A',
        section: user.user_metadata?.section || 'N/A',
        role: user.user_metadata?.role || 'student'
      };
    }

    // Merge section from user metadata if table schema doesn't yet have section column
    if (!profile.section && user.user_metadata?.section) {
      profile.section = user.user_metadata.section;
    }

    return profile;
  } catch (err) {
    console.error('Error fetching user profile:', err);
    return null;
  }
}

/**
 * Route Guard: Protects student or admin pages.
 */
export async function requireAuth(requiredRole = null) {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.href = 'login.html';
    return null;
  }

  const profile = await getUserProfile();

  if (!profile) {
    window.location.href = 'login.html';
    return null;
  }

  if (requiredRole === 'admin' || requiredRole === 'teacher') {
    if (profile.role !== 'admin' && profile.role !== 'teacher') {
      showToast('Access restricted to faculty and administrator accounts only.', 'danger');
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 1200);
      return null;
    }
  }

  renderNavbar(profile);
  return profile;
}

/**
 * Dynamically updates the navigation bar with active user information and logout button.
 */
export function renderNavbar(profile) {
  const navContainer = document.querySelector('.navbar-nav');
  if (!navContainer) return;

  const isTeacher = profile.role === 'teacher' || profile.role === 'admin';
  const roleBadge = isTeacher 
    ? '<span class="badge badge-primary">Instructor / Admin</span>' 
    : '<span class="badge badge-published">Student</span>';

  const dashboardLink = isTeacher ? 'admin/index.html' : 'dashboard.html';
  const historyLink = isTeacher ? '' : '<a href="results.html" class="nav-link">Results</a>';
  const adminLinks = isTeacher ? '<a href="admin/index.html" class="nav-link">Teacher Console</a>' : '';

  navContainer.innerHTML = `
    <a href="${dashboardLink}" class="nav-link">Dashboard</a>
    ${historyLink}
    ${adminLinks}
    <div class="user-pill">
      <div class="user-avatar">${(profile.full_name || 'U').charAt(0).toUpperCase()}</div>
      <span style="font-weight: 600;">${profile.full_name || profile.email}</span>
      ${roleBadge}
    </div>
    <button id="nav-logout-btn" class="btn btn-outline btn-sm" title="Log Out">Sign Out</button>
  `;

  document.getElementById('nav-logout-btn')?.addEventListener('click', signOut);
}
