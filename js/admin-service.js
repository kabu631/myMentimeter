/**
 * ==============================================================================
 * js/admin-service.js - Centralized Data Service for Instructor Dashboard
 * ==============================================================================
 * Enforces admin authorization, handles quiz CRUD, student lookups,
 * and RFC 4180 CSV export generation.
 */

import { getSupabase, showToast } from './supabase.js';
import { requireAuth } from './auth.js';

/**
 * Checks that the user is an authenticated teacher or admin.
 * Redirects unauthorized users to dashboard.html or login.html.
 */
export async function guardAdminPage() {
  const profile = await requireAuth('teacher');
  if (!profile) return null;

  if (profile.role !== 'teacher' && profile.role !== 'admin') {
    showToast('Unauthorized. Faculty / Admin access required.', 'danger');
    setTimeout(() => {
      window.location.href = '../dashboard.html';
    }, 1000);
    return null;
  }

  renderAdminNav(profile);
  return profile;
}

/**
 * Renders the top navigation bar for all admin pages
 */
export function renderAdminNav(profile) {
  const nav = document.querySelector('.navbar-nav');
  if (!nav) return;

  const currentPath = window.location.pathname;

  const isOverview = currentPath.endsWith('index.html') || currentPath.endsWith('/admin/');
  const isQuizzes = currentPath.includes('quizzes.html') || currentPath.includes('create-quiz.html');
  const isStudents = currentPath.includes('students.html');
  const isResults = currentPath.includes('results.html');

  nav.innerHTML = `
    <a href="index.html" class="nav-link ${isOverview ? 'active' : ''}">Overview</a>
    <a href="quizzes.html" class="nav-link ${isQuizzes ? 'active' : ''}">Quizzes</a>
    <a href="students.html" class="nav-link ${isStudents ? 'active' : ''}">Students</a>
    <a href="results.html" class="nav-link ${isResults ? 'active' : ''}">Results &amp; Export</a>
    <div class="user-pill" style="margin-left: 0.5rem;">
      <div class="user-avatar">${(profile.full_name || 'A').charAt(0).toUpperCase()}</div>
      <span style="font-weight: 600;">${profile.full_name || 'Faculty Admin'}</span>
      <span class="badge badge-primary">Admin</span>
    </div>
    <button id="admin-signout-btn" class="btn btn-outline btn-sm">Sign Out</button>
  `;

  document.getElementById('admin-signout-btn')?.addEventListener('click', async () => {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
    sessionStorage.clear();
    window.location.href = '../login.html';
  });
}

/**
 * Loads high-level statistics for the admin dashboard
 */
export async function getAdminOverviewMetrics() {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    // 1. Total Enrolled Students
    const { count: totalStudents, error: sErr } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'student');

    if (sErr) throw sErr;

    // 2. Quizzes breakdown
    const { data: quizzes, error: qErr } = await supabase
      .from('quizzes')
      .select('id, status');

    if (qErr) throw qErr;

    const totalQuizzes = quizzes ? quizzes.length : 0;
    const publishedQuizzes = quizzes ? quizzes.filter(q => q.status === 'published').length : 0;
    const draftQuizzes = quizzes ? quizzes.filter(q => q.status === 'draft').length : 0;
    const closedQuizzes = quizzes ? quizzes.filter(q => q.status === 'closed').length : 0;

    // 3. Total Quiz Attempts
    const { count: totalAttempts, error: aErr } = await supabase
      .from('quiz_attempts')
      .select('*', { count: 'exact', head: true });

    if (aErr) throw aErr;

    return {
      totalStudents: totalStudents || 0,
      totalQuizzes,
      publishedQuizzes,
      draftQuizzes,
      closedQuizzes,
      totalAttempts: totalAttempts || 0
    };

  } catch (err) {
    console.error('Error fetching admin metrics:', err);
    return null;
  }
}

/**
 * Fetches all quizzes with their question counts and attempt counts
 */
export async function getAllQuizzesWithCounts() {
  const supabase = getSupabase();
  if (!supabase) return [];

  try {
    const { data: quizzes, error: qErr } = await supabase
      .from('quizzes')
      .select('*, questions(count), quiz_attempts(count)')
      .order('class_number', { ascending: true });

    if (qErr) throw qErr;

    return quizzes || [];
  } catch (err) {
    console.error('Error loading quizzes:', err);
    showToast('Failed to load quizzes: ' + err.message, 'danger');
    return [];
  }
}

/**
 * Updates a quiz lifecycle status (draft, published, closed)
 */
export async function updateQuizStatus(quizId, newStatus) {
  const supabase = getSupabase();
  if (!supabase) return false;

  try {
    const { error } = await supabase
      .from('quizzes')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', quizId);

    if (error) throw error;
    showToast(`Quiz status changed to ${newStatus}.`, 'success');
    return true;
  } catch (err) {
    showToast('Failed to update status: ' + err.message, 'danger');
    return false;
  }
}

/**
 * Safely deletes a quiz ONLY when attempts count is 0
 */
export async function deleteQuizSafely(quizId, attemptCount) {
  if (attemptCount > 0) {
    alert(`Safety Lock: Cannot delete this quiz because students have already submitted ${attemptCount} attempt(s). Closing the quiz preserves student grade records while stopping new attempts.`);
    return false;
  }

  if (!confirm('Are you sure you want to permanently delete this quiz and its questions?')) {
    return false;
  }

  const supabase = getSupabase();
  if (!supabase) return false;

  try {
    const { error } = await supabase
      .from('quizzes')
      .delete()
      .eq('id', quizId);

    if (error) throw error;
    showToast('Quiz deleted permanently.', 'info');
    return true;
  } catch (err) {
    showToast('Failed to delete quiz: ' + err.message, 'danger');
    return false;
  }
}

/**
 * Fetches all registered students
 */
export async function getRegisteredStudents() {
  const supabase = getSupabase();
  if (!supabase) return [];

  try {
    const { data: students, error: sErr } = await supabase
      .from('profiles')
      .select('*, quiz_attempts(count)')
      .eq('role', 'student')
      .order('student_id', { ascending: true });

    if (sErr) throw sErr;
    return students || [];
  } catch (err) {
    console.error('Error loading students:', err);
    showToast('Failed to load students: ' + err.message, 'danger');
    return [];
  }
}

/**
 * Fetches all student quiz results
 */
export async function getAllQuizResults() {
  const supabase = getSupabase();
  if (!supabase) return [];

  try {
    const { data: attempts, error } = await supabase
      .from('quiz_attempts')
      .select(`
        id,
        score,
        total_marks,
        submitted_at,
        profiles (
          id,
          student_id,
          full_name,
          email,
          section
        ),
        quizzes (
          id,
          class_number,
          title,
          scheduled_date
        )
      `)
      .order('submitted_at', { ascending: false });

    if (error) throw error;
    return attempts || [];
  } catch (err) {
    console.error('Error loading results:', err);
    showToast('Failed to load results: ' + err.message, 'danger');
    return [];
  }
}

/**
 * Export results for a single quiz as CSV
 */
export function exportSingleQuizCSV(quizTitle, classNumber, attemptsForQuiz) {
  if (!attemptsForQuiz || attemptsForQuiz.length === 0) {
    showToast('No submitted attempts for this quiz to export.', 'warning');
    return;
  }

  const headers = ['Student ID', 'Full Name', 'Section', 'Email', 'Score', 'Total Marks', 'Accuracy (%)', 'Submission Time'];
  const rows = [headers.join(',')];

  attemptsForQuiz.forEach(att => {
    const s = att.profiles;
    const score = Number(att.score || 0);
    const total = Number(att.total_marks || 0);
    const pct = total > 0 ? ((score / total) * 100).toFixed(1) : '0.0';
    const submitted = new Date(att.submitted_at).toLocaleString();

    rows.push([
      escapeCsv(s?.student_id || 'N/A'),
      escapeCsv(s?.full_name || 'N/A'),
      escapeCsv(s?.section || 'General'),
      escapeCsv(s?.email || 'N/A'),
      score.toFixed(1),
      total.toFixed(1),
      `${pct}%`,
      escapeCsv(submitted)
    ].join(','));
  });

  downloadCsvBlob(rows.join('\r\n'), `Class_${String(classNumber).padStart(2, '0')}_Quiz_Results.csv`);
}

/**
 * Export complete semester gradebook matrix as CSV (Students x Classes 1-35)
 */
export async function exportSemesterGradebookCSV() {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    showToast('Generating complete semester gradebook CSV...', 'info');

    const [students, quizzes, attempts] = await Promise.all([
      getRegisteredStudents(),
      supabase.from('quizzes').select('id, class_number, title').order('class_number', { ascending: true }).then(r => r.data || []),
      supabase.from('quiz_attempts').select('student_id, quiz_id, score, total_marks').then(r => r.data || [])
    ]);

    if (!students || students.length === 0) {
      showToast('No students registered to export.', 'warning');
      return;
    }

    const attemptMap = new Map();
    attempts.forEach(a => attemptMap.set(`${a.student_id}_${a.quiz_id}`, a));

    const headers = ['Student ID / Roll No', 'Full Name', 'Section', 'Email'];
    quizzes.forEach(q => {
      headers.push(`Class ${String(q.class_number).padStart(2, '0')} (${escapeCsv(q.title)})`);
    });
    headers.push('Total Accumulated Score', 'Total Possible Marks', 'Semester Percentage (%)');

    const rows = [headers.join(',')];

    students.forEach(student => {
      let accumulated = 0;
      let totalPossible = 0;

      const row = [
        escapeCsv(student.student_id || 'N/A'),
        escapeCsv(student.full_name || 'N/A'),
        escapeCsv(student.section || 'General'),
        escapeCsv(student.email || 'N/A')
      ];

      quizzes.forEach(q => {
        const key = `${student.id}_${q.id}`;
        const att = attemptMap.get(key);
        if (att) {
          const sc = Number(att.score || 0);
          const tot = Number(att.total_marks || 0);
          accumulated += sc;
          totalPossible += tot;
          row.push(sc.toFixed(1));
        } else {
          row.push('0.0');
        }
      });

      const pct = totalPossible > 0 ? ((accumulated / totalPossible) * 100).toFixed(1) : '0.0';
      row.push(accumulated.toFixed(1));
      row.push(totalPossible.toFixed(1));
      row.push(`${pct}%`);

      rows.push(row.join(','));
    });

    const dateStr = new Date().toISOString().split('T')[0];
    downloadCsvBlob(rows.join('\r\n'), `Semester_Daily_Quiz_Gradebook_${dateStr}.csv`);
    showToast('Semester Gradebook CSV exported successfully!', 'success');

  } catch (err) {
    console.error('Error exporting semester CSV:', err);
    showToast('Failed to export CSV: ' + err.message, 'danger');
  }
}

function escapeCsv(str) {
  if (str === null || str === undefined) return '""';
  const text = String(str).replace(/"/g, '""');
  return `"${text}"`;
}

function downloadCsvBlob(csvContent, filename) {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
