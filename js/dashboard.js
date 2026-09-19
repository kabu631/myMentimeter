/**
 * ==============================================================================
 * js/dashboard.js - Student Dashboard Controller
 * ==============================================================================
 * Retrieves and renders:
 * 1. Student Name, Student ID, and Class Section
 * 2. Today's published quiz and attempt status
 * 3. Total accumulated quiz marks & total possible marks
 * 4. Number of quizzes attempted vs available
 * 5. Recent quiz results breakdown
 * 6. Logout control
 */

import { getSupabase, showToast } from './supabase.js';
import { requireAuth, signOut } from './auth.js';

let currentUser = null;

async function initStudentDashboard() {
  // Ensure the user is authenticated as a student
  currentUser = await requireAuth('student');
  if (!currentUser) return;

  // 1. Render Student Identity
  renderStudentProfile(currentUser);

  // 2. Setup Logout Handler
  document.getElementById('btn-student-logout')?.addEventListener('click', signOut);

  // 3. Load Live Quiz Data and Stats from Supabase
  await loadDashboardData();
}

/**
 * Populates student identity header
 */
function renderStudentProfile(profile) {
  const nameElem = document.getElementById('student-name');
  const idElem = document.getElementById('student-id');
  const sectionElem = document.getElementById('student-section');
  const emailElem = document.getElementById('student-email');

  if (nameElem) nameElem.textContent = profile.full_name || 'Student';
  if (idElem) idElem.textContent = profile.student_id || 'Not Assigned';
  if (sectionElem) sectionElem.textContent = profile.section || 'General Section';
  if (emailElem) emailElem.textContent = profile.email || '';
}

/**
 * Retrieves today's quiz, student scores, attempt history, and cumulative metrics
 */
async function loadDashboardData() {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    // --------------------------------------------------------------------------
    // A. FETCH ALL PUBLISHED/CLOSED QUIZZES (Available Quizzes Count)
    // --------------------------------------------------------------------------
    const { data: allAvailableQuizzes, error: availErr } = await supabase
      .from('quizzes')
      .select('id, class_number, title, scheduled_date, status')
      .in('status', ['published', 'closed'])
      .order('class_number', { ascending: true });

    if (availErr) throw availErr;
    const totalAvailableCount = allAvailableQuizzes ? allAvailableQuizzes.length : 0;

    // --------------------------------------------------------------------------
    // B. FETCH CURRENT STUDENT'S ATTEMPTS (Enforced by RLS to own data only)
    // --------------------------------------------------------------------------
    const { data: attempts, error: attErr } = await supabase
      .from('quiz_attempts')
      .select(`
        id,
        quiz_id,
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
      .eq('student_id', currentUser.id)
      .order('submitted_at', { ascending: false });

    if (attErr) throw attErr;

    // Calculate Cumulative Scores & Attempt Counts
    let accumulatedScore = 0;
    let totalPossibleMarks = 0;
    const attemptedCount = attempts ? attempts.length : 0;

    const attemptsByQuizId = new Map();
    attempts?.forEach(att => {
      accumulatedScore += Number(att.score || 0);
      totalPossibleMarks += Number(att.total_marks || 0);
      attemptsByQuizId.set(att.quiz_id, att);
    });

    // --------------------------------------------------------------------------
    // C. UPDATE SCORE & PARTICIPATION METRICS
    // --------------------------------------------------------------------------
    const totalScoreDisplay = document.getElementById('stat-total-score');
    const attemptsCountDisplay = document.getElementById('stat-attempts-count');
    const accuracyDisplay = document.getElementById('stat-accuracy-rate');

    if (totalScoreDisplay) {
      totalScoreDisplay.textContent = `${accumulatedScore.toFixed(1)} / ${totalPossibleMarks.toFixed(1)}`;
    }

    if (attemptsCountDisplay) {
      attemptsCountDisplay.textContent = `${attemptedCount} / ${totalAvailableCount}`;
    }

    if (accuracyDisplay) {
      const accuracyPct = totalPossibleMarks > 0 
        ? ((accumulatedScore / totalPossibleMarks) * 100).toFixed(1) 
        : '0.0';
      accuracyDisplay.textContent = `${accuracyPct}%`;
    }

    // --------------------------------------------------------------------------
    // D. FETCH & RENDER TODAY'S ACTIVE QUIZ
    // --------------------------------------------------------------------------
    await renderTodayQuiz(attemptsByQuizId);

    // --------------------------------------------------------------------------
    // E. RENDER RECENT QUIZ RESULTS
    // --------------------------------------------------------------------------
    renderRecentResults(attempts);

  } catch (err) {
    console.error('Error loading dashboard data:', err);
    showToast('Failed to load dashboard metrics: ' + err.message, 'danger');
  }
}

/**
 * Detects today's published quiz and shows either:
 * - [Start Quiz] (if not yet attempted)
 * - [Completed] Score: X / Y (if already submitted)
 * - Friendly message (if no quiz is published)
 */
async function renderTodayQuiz(attemptsByQuizId) {
  const supabase = getSupabase();
  const container = document.getElementById('today-quiz-card-container');
  if (!supabase || !container) return;

  try {
    // Look for currently active published quiz
    const { data: publishedQuizzes, error: pubErr } = await supabase
      .from('quizzes')
      .select('id, class_number, title, description, scheduled_date, time_limit_minutes, status')
      .eq('status', 'published')
      .order('scheduled_date', { ascending: false })
      .order('class_number', { ascending: false })
      .limit(1);

    if (pubErr) throw pubErr;

    if (!publishedQuizzes || publishedQuizzes.length === 0) {
      container.innerHTML = `
        <div class="card" style="border-left: 4px solid var(--info); background: var(--bg-card); padding: 1.5rem;">
          <div style="display: flex; gap: 1rem; align-items: center;">
            <div class="empty-icon" style="margin: 0; width: 48px; height: 48px; flex-shrink: 0;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div>
              <h3 style="margin-bottom: 0.25rem;">No Quiz Published Today</h3>
              <p style="margin: 0; color: var(--text-muted); font-size: 0.95rem;">
                There is no active quiz scheduled right now. Check back during or immediately after your lecture!
              </p>
            </div>
          </div>
        </div>
      `;
      return;
    }

    const todayQuiz = publishedQuizzes[0];

    // Count questions and compute total marks for this quiz safely
    let qList = [];
    const sqRes = await supabase
      .from('student_questions')
      .select('id, marks')
      .eq('quiz_id', todayQuiz.id);

    if (sqRes.data && sqRes.data.length > 0) {
      qList = sqRes.data;
    } else {
      const qRes = await supabase
        .from('questions')
        .select('id, marks')
        .eq('quiz_id', todayQuiz.id);
      qList = qRes.data || [];
    }

    const questionCount = qList.length;
    let quizTotalMarks = 0;
    qList.forEach(q => quizTotalMarks += Number(q.marks || 1.0));

    // Check if this student has already submitted an attempt
    const studentAttempt = attemptsByQuizId.get(todayQuiz.id);

    if (studentAttempt) {
      // ------------------------------------------------------------------------
      // ALREADY ATTEMPTED STATE
      // ------------------------------------------------------------------------
      const pct = studentAttempt.total_marks > 0 
        ? Math.round((studentAttempt.score / studentAttempt.total_marks) * 100) 
        : 0;

      container.innerHTML = `
        <div class="card" style="border: 1px solid var(--success-border); background: var(--bg-card); padding: 1.75rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1.25rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.5rem;">
                <span class="badge badge-published">Completed</span>
                <span class="badge badge-primary">Class ${String(todayQuiz.class_number).padStart(2, '0')}</span>
                <span style="font-size: 0.85rem; color: var(--text-muted);">${todayQuiz.scheduled_date}</span>
              </div>
              <h2 style="font-size: 1.5rem; margin-bottom: 0.35rem;">${todayQuiz.title}</h2>
              <div style="font-size: 0.95rem; color: var(--text-secondary);">
                ${questionCount} questions &bull; ${quizTotalMarks.toFixed(1)} marks total
              </div>
            </div>

            <div style="text-align: right; min-width: 180px;">
              <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 0.25rem;">Your Score</div>
              <div style="font-family: var(--font-heading); font-size: 2rem; font-weight: 800; color: var(--success); line-height: 1;">
                ${Number(studentAttempt.score).toFixed(1)} <span style="font-size: 1rem; color: var(--text-muted);">/ ${Number(studentAttempt.total_marks).toFixed(1)}</span>
              </div>
              <div style="margin-top: 0.5rem; display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem;">
                <span class="badge badge-published">${pct}% Accuracy</span>
                <a href="results.html" class="btn btn-outline btn-sm" style="font-size: 0.8rem; padding: 0.3rem 0.75rem;">
                  Review Answers &rarr;
                </a>
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      // ------------------------------------------------------------------------
      // AVAILABLE TO START STATE
      // ------------------------------------------------------------------------
      const timeInfo = todayQuiz.time_limit_minutes 
        ? `${todayQuiz.time_limit_minutes} min limit` 
        : `Untimed`;

      container.innerHTML = `
        <div class="card hover-lift" style="border: 2px solid var(--primary); background: radial-gradient(circle at top right, rgba(79, 70, 229, 0.08), var(--bg-card)); padding: 2rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1.5rem;">
            <div style="flex: 1; min-width: 280px;">
              <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.5rem;">
                <span class="badge badge-warning">Available Now</span>
                <span class="badge badge-primary">Class ${String(todayQuiz.class_number).padStart(2, '0')}</span>
                <span style="font-size: 0.85rem; color: var(--text-muted);">${todayQuiz.scheduled_date}</span>
              </div>

              <h2 style="font-size: 1.65rem; margin-bottom: 0.5rem;">
                Class ${todayQuiz.class_number} &mdash; ${todayQuiz.title}
              </h2>

              <p style="color: var(--text-secondary); margin-bottom: 1rem; max-width: 600px;">
                ${todayQuiz.description || 'Test your knowledge on today\'s lecture topics. One attempt allowed.'}
              </p>

              <div style="display: flex; gap: 1.5rem; font-size: 0.9rem; color: var(--text-muted); font-weight: 500; flex-wrap: wrap;">
                <span><strong>${questionCount}</strong> questions</span>
                <span><strong>${quizTotalMarks.toFixed(1)}</strong> marks</span>
                <span>${timeInfo}</span>
                <span>1 Attempt Only</span>
              </div>
            </div>

            <div>
              <a href="quiz.html?id=${todayQuiz.id}" class="btn btn-primary btn-lg" style="padding: 1rem 2.25rem; font-size: 1.1rem; box-shadow: var(--shadow-sm);">
                Start Quiz &rarr;
              </a>
            </div>
          </div>
        </div>
      `;
    }

  } catch (err) {
    console.error('Error rendering today quiz:', err);
    container.innerHTML = `<div class="alert alert-danger">Error loading quiz: ${err.message}</div>`;
  }
}

/**
 * Renders the recent quiz results list
 */
function renderRecentResults(attempts) {
  const tbody = document.getElementById('recent-results-body');
  if (!tbody) return;

  if (!attempts || attempts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state" style="padding: 2.5rem 1rem;">
          <div class="empty-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
          </div>
          <div class="empty-title">No Quizzes Attempted Yet</div>
          <p class="empty-text">Your submitted quiz results and scores will appear here after each lecture.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = attempts.slice(0, 5).map(att => {
    const q = att.quizzes;
    const score = Number(att.score || 0);
    const total = Number(att.total_marks || 0);
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    const badgeClass = pct >= 80 ? 'badge-published' : pct >= 50 ? 'badge-warning' : 'badge-closed';

    return `
      <tr>
        <td>
          <span class="badge badge-primary">Class ${String(q?.class_number || 0).padStart(2, '0')}</span>
        </td>
        <td>
          <strong>${q?.title || 'Daily Lecture Quiz'}</strong>
        </td>
        <td>
          <span style="color: var(--text-muted); font-size: 0.85rem;">
            ${q?.scheduled_date || new Date(att.submitted_at).toLocaleDateString()}
          </span>
        </td>
        <td>
          <strong style="color: var(--text-primary); font-size: 1rem;">
            ${score.toFixed(1)} / ${total.toFixed(1)}
          </strong>
          <span class="badge ${badgeClass}" style="margin-left: 0.5rem;">${pct}%</span>
        </td>
        <td>
          <span class="badge badge-published">Completed</span>
        </td>
      </tr>
    `;
  }).join('');
}

document.addEventListener('DOMContentLoaded', initStudentDashboard);
