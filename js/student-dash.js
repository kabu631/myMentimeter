/**
 * student-dash.js - Logic for Student Dashboard
 */

import { getSupabase } from './supabase.js';
import { requireAuth } from './auth.js';
import { APP_CONFIG } from './config.js';

let currentUserProfile = null;

async function initDashboard() {
  currentUserProfile = await requireAuth('student');
  if (!currentUserProfile) return;

  // Render greeting
  document.getElementById('student-name-display').textContent = currentUserProfile.full_name || 'Student';
  document.getElementById('student-id-display').textContent = currentUserProfile.student_id ? `Roll No: ${currentUserProfile.student_id}` : '';

  await Promise.all([
    loadTodayQuiz(),
    loadStudentStatsAndHistory()
  ]);
}

/**
 * Checks if a quiz is published for today (or latest active published quiz)
 * and determines if the student has already submitted it.
 */
async function loadTodayQuiz() {
  const supabase = getSupabase();
  const bannerContainer = document.getElementById('today-quiz-banner');
  if (!supabase || !bannerContainer) return;

  try {
    // 1. Fetch the latest published quiz
    const { data: quizzes, error: quizErr } = await supabase
      .from('quizzes')
      .select('*')
      .eq('status', 'published')
      .order('scheduled_date', { ascending: false })
      .limit(1);

    if (quizErr) throw quizErr;

    if (!quizzes || quizzes.length === 0) {
      // No active published quiz
      bannerContainer.innerHTML = `
        <div class="card" style="border-left: 4px solid var(--info); background: var(--bg-card); padding: 1.5rem;">
          <div style="display: flex; align-items: center; gap: 1rem;">
            <div class="empty-icon" style="margin: 0; width: 44px; height: 44px; flex-shrink: 0;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div>
              <h3 style="margin-bottom: 0.25rem;">No Active Quiz Right Now</h3>
              <p style="margin: 0; color: var(--text-muted);">
                Your teacher has not published a quiz for today yet. Check back during or immediately after class!
              </p>
            </div>
          </div>
        </div>
      `;
      return;
    }

    const todayQuiz = quizzes[0];

    // 2. Count questions for this quiz
    const { count: questionCount } = await supabase
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('quiz_id', todayQuiz.id);

    // 3. Check if current student has already attempted this quiz
    const { data: attempt, error: attemptErr } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('quiz_id', todayQuiz.id)
      .eq('student_id', currentUserProfile.id)
      .maybeSingle();

    if (attemptErr) throw attemptErr;

    if (attempt) {
      // Student already took this quiz
      bannerContainer.innerHTML = `
        <div class="card" style="border-left: 4px solid var(--success); background: var(--bg-card); padding: 1.75rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                <span class="badge badge-published">Completed</span>
                <span style="font-weight: 700; color: var(--text-muted);">Class ${String(todayQuiz.class_number).padStart(2, '0')}</span>
              </div>
              <h2 style="margin-bottom: 0.35rem;">${todayQuiz.title}</h2>
              <p style="margin: 0; color: var(--text-secondary);">
                You finished this quiz! Your score: <strong style="color: var(--success); font-size: 1.1rem;">${attempt.score} / ${attempt.total_marks}</strong>
              </p>
            </div>
            <div>
              <a href="results.html?attempt_id=${attempt.id}" class="btn btn-secondary">
                View Result Breakdown &rarr;
              </a>
            </div>
          </div>
        </div>
      `;
    } else {
      // Available to attempt!
      bannerContainer.innerHTML = `
        <div class="card hover-lift" style="border: 2px solid var(--primary); background: radial-gradient(circle at top right, rgba(79, 70, 229, 0.08), var(--bg-card)); padding: 1.75rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1.5rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                <span class="badge badge-warning">Action Required</span>
                <span class="badge badge-primary">Class ${String(todayQuiz.class_number).padStart(2, '0')}</span>
                <span style="font-size: 0.85rem; color: var(--text-muted);">${todayQuiz.scheduled_date}</span>
              </div>
              <h2 style="margin-bottom: 0.5rem; font-size: 1.6rem;">${todayQuiz.title}</h2>
              <p style="margin-bottom: 0.75rem; color: var(--text-secondary); max-width: 600px;">
                ${todayQuiz.description || 'Test your understanding of today\'s lecture topics. One attempt allowed.'}
              </p>
              <div style="display: flex; gap: 1.25rem; font-size: 0.85rem; color: var(--text-muted);">
                <span><strong>${questionCount || 0}</strong> Questions</span>
                <span><strong>${todayQuiz.time_limit_minutes ? todayQuiz.time_limit_minutes + ' min' : 'Untimed'}</strong></span>
                <span>Single Attempt</span>
              </div>
            </div>
            <div>
              <a href="quiz.html?id=${todayQuiz.id}" class="btn btn-primary btn-lg" style="font-size: 1.1rem; padding: 1rem 2rem;">
                Start Today's Quiz Now &rarr;
              </a>
            </div>
          </div>
        </div>
      `;
    }
  } catch (err) {
    console.error('Error loading today quiz:', err);
    bannerContainer.innerHTML = `<div class="alert alert-danger">Error loading today's quiz: ${err.message}</div>`;
  }
}

/**
 * Loads overall student cumulative semester score, attendance, and recent quiz history.
 */
async function loadStudentStatsAndHistory() {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    // Fetch all attempts for this student with quiz details
    const { data: attempts, error } = await supabase
      .from('quiz_attempts')
      .select(`
        id,
        score,
        total_marks,
        submitted_at,
        quizzes (
          id,
          class_number,
          title,
          scheduled_date,
          status
        )
      `)
      .eq('student_id', currentUserProfile.id)
      .order('submitted_at', { ascending: false });

    if (error) throw error;

    let totalScoreEarned = 0;
    let totalScorePossible = 0;
    const completedCount = attempts ? attempts.length : 0;

    attempts?.forEach(att => {
      totalScoreEarned += Number(att.score || 0);
      totalScorePossible += Number(att.total_marks || 0);
    });

    const avgPercentage = totalScorePossible > 0 
      ? ((totalScoreEarned / totalScorePossible) * 100).toFixed(1) 
      : '0.0';

    // Update Stats Display
    document.getElementById('stat-cumulative-score').textContent = `${totalScoreEarned.toFixed(1)} / ${totalScorePossible.toFixed(1)}`;
    document.getElementById('stat-quizzes-completed').textContent = `${completedCount} / ${APP_CONFIG.SEMESTER_TOTAL_CLASSES}`;
    document.getElementById('stat-average-accuracy').textContent = `${avgPercentage}%`;

    const progressPct = Math.min(100, Math.round((completedCount / APP_CONFIG.SEMESTER_TOTAL_CLASSES) * 100));
    const progressFill = document.getElementById('semester-progress-fill');
    if (progressFill) {
      progressFill.style.width = `${progressPct}%`;
    }
    document.getElementById('semester-progress-label').textContent = `${progressPct}% of Semester Completed (${completedCount} of ${APP_CONFIG.SEMESTER_TOTAL_CLASSES} Classes)`;

    // Render Recent Activity Table
    const tableBody = document.getElementById('recent-quizzes-body');
    if (!tableBody) return;

    if (!attempts || attempts.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-state" style="padding: 2rem;">
            <div class="empty-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
            </div>
            <div class="empty-title">No Quizzes Taken Yet</div>
            <p class="empty-text">Once you complete quizzes after each class, your scores and review links will appear here.</p>
          </td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = attempts.slice(0, 5).map(att => {
      const q = att.quizzes;
      const pct = att.total_marks > 0 ? Math.round((att.score / att.total_marks) * 100) : 0;
      const badgeClass = pct >= 80 ? 'badge-published' : pct >= 50 ? 'badge-warning' : 'badge-closed';

      return `
        <tr>
          <td><span class="badge badge-primary">Class ${String(q?.class_number || 0).padStart(2, '0')}</span></td>
          <td><strong>${q?.title || 'Daily Quiz'}</strong></td>
          <td>${q?.scheduled_date || 'N/A'}</td>
          <td>
            <strong>${att.score} / ${att.total_marks}</strong>
            <span class="badge ${badgeClass}" style="margin-left: 0.5rem;">${pct}%</span>
          </td>
          <td>
            <a href="results.html?attempt_id=${att.id}" class="btn btn-outline btn-sm">Review</a>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error loading stats:', err);
  }
}

// Run on page load
document.addEventListener('DOMContentLoaded', initDashboard);
