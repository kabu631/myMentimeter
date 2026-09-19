/**
 * ==============================================================================
 * js/results.js - Complete Student Results & Performance Breakdown
 * ==============================================================================
 * Features:
 * 1. Every quiz attempted (Class/Quiz #, title, date, score, total marks, percentage, submission time)
 * 2. SEMESTER SUMMARY:
 *    - Total earned: XXX
 *    - Total possible: XXX
 *    - Percentage: XX.XX%
 *    - Quizzes attempted: XX / XX
 * 3. Question-by-Question Drilldown:
 *    - Question prompts & options
 *    - Student's selected answers
 *    - Correct answers (strictly if teacher configuration allows it: show_correct_answers = true)
 *    - Marks earned vs marks possible
 * 4. Anti-Cheat & Privacy:
 *    - Students only retrieve their own attempts and answers.
 *    - Answers are never revealed for unattempted quizzes.
 */

import { getSupabase, showToast } from './supabase.js';
import { requireAuth, signOut } from './auth.js';
import { APP_CONFIG } from './config.js';

let currentUser = null;
let studentAttempts = [];
let allPublishedCount = 0;

async function initResultsSection() {
  currentUser = await requireAuth('student');
  if (!currentUser) return;

  document.getElementById('nav-logout-btn')?.addEventListener('click', signOut);

  await loadStudentResults();

  // Check if a specific attempt was requested via query param (e.g. results.html?attempt_id=...)
  const urlParams = new URLSearchParams(window.location.search);
  const targetAttemptId = urlParams.get('attempt_id');
  if (targetAttemptId) {
    openAttemptModal(targetAttemptId);
  }
}

/**
 * Loads student's attempts and overall published quiz count
 */
async function loadStudentResults() {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    // 1. Fetch total published or closed quizzes count
    const { count: pubCount, error: pubErr } = await supabase
      .from('quizzes')
      .select('*', { count: 'exact', head: true })
      .in('status', ['published', 'closed']);

    if (pubErr) throw pubErr;
    allPublishedCount = pubCount || APP_CONFIG.SEMESTER_TOTAL_CLASSES;

    // 2. Fetch all attempts by this student ONLY (Row Level Security protected)
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
          description,
          scheduled_date,
          show_score_immediately,
          show_correct_answers
        )
      `)
      .eq('student_id', currentUser.id)
      .order('submitted_at', { ascending: false });

    if (attErr) throw attErr;
    studentAttempts = attempts || [];

    // 3. Calculate and render SEMESTER SUMMARY
    renderSemesterSummary();

    // 4. Render Attempted Quizzes Table
    renderAttemptsTable(studentAttempts);

    // Setup Search Filter
    document.getElementById('results-search-input')?.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      const filtered = studentAttempts.filter(att => {
        const q = att.quizzes;
        return (q?.title || '').toLowerCase().includes(term) ||
               String(q?.class_number || '').includes(term);
      });
      renderAttemptsTable(filtered);
    });

  } catch (err) {
    console.error('Error loading results:', err);
    showToast('Failed to load quiz results: ' + err.message, 'danger');
  }
}

/**
 * Calculates and displays the SEMESTER SUMMARY section
 */
function renderSemesterSummary() {
  let totalEarned = 0;
  let totalPossible = 0;
  const attemptedCount = studentAttempts.length;

  studentAttempts.forEach(att => {
    totalEarned += Number(att.score || 0);
    totalPossible += Number(att.total_marks || 0);
  });

  const percentage = totalPossible > 0 
    ? ((totalEarned / totalPossible) * 100).toFixed(2) 
    : '0.00';

  // Format nicely (e.g., integers without trailing decimals if whole)
  const formatNum = (num) => Number.isInteger(num) ? num.toString() : num.toFixed(2);

  // Update Summary DOM elements
  document.getElementById('summary-total-earned').textContent = formatNum(totalEarned);
  document.getElementById('summary-total-possible').textContent = formatNum(totalPossible);
  document.getElementById('summary-percentage').textContent = `${percentage}%`;
  document.getElementById('summary-attempted-count').textContent = `${attemptedCount} / ${allPublishedCount}`;

  // Progress Bar
  const progressPct = allPublishedCount > 0 
    ? Math.min(100, Math.round((attemptedCount / allPublishedCount) * 100)) 
    : 0;
  
  const fill = document.getElementById('summary-progress-fill');
  if (fill) fill.style.width = `${progressPct}%`;
  
  const label = document.getElementById('summary-progress-label');
  if (label) label.textContent = `${progressPct}% of Available Quizzes Attempted`;
}

/**
 * Renders the table of every quiz attempted
 */
function renderAttemptsTable(list) {
  const tbody = document.getElementById('attempts-table-body');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state" style="padding: 2.5rem 1rem;">
          <div class="empty-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
          </div>
          <div class="empty-title">No Quizzes Attempted Yet</div>
          <p class="empty-text">Once you complete quizzes, your scores and review breakdowns will appear here.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map(att => {
    const q = att.quizzes;
    const score = Number(att.score || 0);
    const total = Number(att.total_marks || 0);
    const pct = total > 0 ? ((score / total) * 100).toFixed(2) : '0.00';
    const badgeClass = Number(pct) >= 80 ? 'badge-published' : Number(pct) >= 50 ? 'badge-warning' : 'badge-closed';

    const subTime = new Date(att.submitted_at).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const quizDate = q?.scheduled_date || 'N/A';
    const classNum = String(q?.class_number || 0).padStart(2, '0');

    return `
      <tr style="cursor: pointer;" onclick="window.inspectAttempt('${att.id}')">
        <td>
          <span class="badge badge-primary">Quiz #${classNum}</span>
        </td>
        <td>
          <strong style="color: var(--text-primary); font-size: 0.95rem;">${escapeHtml(q?.title || 'Daily Quiz')}</strong>
        </td>
        <td>
          <span style="color: var(--text-muted); font-size: 0.9rem;">${quizDate}</span>
        </td>
        <td>
          <strong style="color: var(--success); font-size: 1.05rem;">${score}</strong>
        </td>
        <td>
          <span style="color: var(--text-muted); font-size: 0.95rem;">${total}</span>
        </td>
        <td>
          <span class="badge ${badgeClass}" style="font-size: 0.85rem; font-weight: 700;">${pct}%</span>
        </td>
        <td>
          <span style="color: var(--text-secondary); font-size: 0.85rem;">${subTime}</span>
        </td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); window.inspectAttempt('${att.id}')">
            View Details &rarr;
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Expose inspectAttempt globally for table row clicks
 */
window.inspectAttempt = async function(attemptId) {
  openAttemptModal(attemptId);
};

/**
 * Opens detailed question-by-question breakdown for an individual quiz
 */
async function openAttemptModal(attemptId) {
  const supabase = getSupabase();
  const modal = document.getElementById('quiz-detail-modal');
  const title = document.getElementById('modal-detail-title');
  const scoreBadge = document.getElementById('modal-detail-score-badge');
  const container = document.getElementById('modal-questions-container');

  modal.classList.add('active');
  container.innerHTML = `
    <div style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
      <div class="empty-icon" style="margin: 0 auto 0.75rem;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>
      <div>Loading detailed question review...</div>
    </div>
  `;

  try {
    // 1. Check if the attempt is cached in memory
    const attempt = studentAttempts.find(a => a.id === attemptId);
    let quiz = attempt?.quizzes;

    if (!quiz) {
      const { data: fetchedAtt } = await supabase
        .from('quiz_attempts')
        .select('*, quizzes(*)')
        .eq('id', attemptId)
        .single();
      quiz = fetchedAtt?.quizzes;
    }

    if (quiz) {
      title.textContent = `Class ${String(quiz.class_number).padStart(2, '0')}: ${quiz.title}`;
    }

    const sc = Number(attempt?.score || 0);
    const tot = Number(attempt?.total_marks || 0);
    const pct = tot > 0 ? Math.round((sc / tot) * 100) : 0;
    scoreBadge.textContent = `Score: ${sc} / ${tot} (${pct}%)`;

    // 2. TRIPLE-LAYER FETCH:
    // Strategy A: Try stored RPC get_student_attempt_review
    // Strategy B: Try localStorage cached review from submission
    // Strategy C: Fallback to querying attempt_answers + student_questions view

    let questionsList = null;
    let allowCorrectAnswers = Boolean(quiz?.show_correct_answers);

    // Try Strategy A: RPC get_student_attempt_review
    try {
      const { data: rpcData, error: rpcErr } = await supabase
        .rpc('get_student_attempt_review', { p_attempt_id: attemptId });

      if (!rpcErr && rpcData && rpcData.success && rpcData.questions) {
        questionsList = rpcData.questions;
        allowCorrectAnswers = Boolean(rpcData.attempt?.show_correct_answers);
      }
    } catch (e) {
      console.warn('RPC review not available, trying fallback:', e);
    }

    // Try Strategy B: Check submission cache
    if (!questionsList) {
      try {
        const cachedRaw = localStorage.getItem(`quiz_review_${attemptId}`);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (Array.isArray(cached) && cached.length > 0) {
            questionsList = cached;
          }
        }
      } catch (e) {
        // Cache parse error, proceed to Strategy C
      }
    }

    // Try Strategy C: Direct join via attempt_answers & student_questions view
    if (!questionsList) {
      const quizId = attempt?.quiz_id || quiz?.id;

      // Fetch student's submitted answers
      const { data: answers, error: ansErr } = await supabase
        .from('attempt_answers')
        .select('question_id, selected_option, is_correct, marks_awarded')
        .eq('attempt_id', attemptId);

      if (ansErr) throw ansErr;

      // Fetch questions metadata safely from student_questions view
      let questionsMeta = [];
      const sqRes = await supabase
        .from('student_questions')
        .select('id, question_text, options, marks, order_index')
        .eq('quiz_id', quizId)
        .order('order_index', { ascending: true });

      if (sqRes.data && sqRes.data.length > 0) {
        questionsMeta = sqRes.data;
      } else {
        // Fallback to questions table
        const qRes = await supabase
          .from('questions')
          .select('id, question_text, options, marks, order_index')
          .eq('quiz_id', quizId)
          .order('order_index', { ascending: true });
        questionsMeta = qRes.data || [];
      }

      const metaMap = new Map(questionsMeta.map(q => [q.id, q]));

      questionsList = (answers || []).map(ans => {
        const qMeta = metaMap.get(ans.question_id) || {};
        return {
          question_id: ans.question_id,
          order_index: qMeta.order_index || 0,
          question_text: qMeta.question_text || 'Question Prompt',
          options: qMeta.options || [],
          marks_possible: Number(qMeta.marks || 1.0),
          selected_option: ans.selected_option,
          is_correct: ans.is_correct,
          marks_awarded: Number(ans.marks_awarded || 0),
          correct_option: ans.is_correct ? ans.selected_option : null
        };
      });
    }

    if (!questionsList || questionsList.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 2rem 1rem;">
          <div class="empty-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
          <div class="empty-title">No Answers Recorded</div>
          <p class="empty-text">No question responses were recorded for this attempt.</p>
        </div>
      `;
      return;
    }

    // Sort questions by order_index
    questionsList.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    // Render Question-by-Question Breakdown
    container.innerHTML = questionsList.map((item, idx) => {
      const isCorrect = Boolean(item.is_correct);
      const awarded = Number(item.marks_awarded || 0);
      const possible = Number(item.marks_possible || 1.0);
      const selectedId = item.selected_option || 'None (Skipped)';

      // Resolve human-readable text for selected option
      const optionsArr = item.options || [];
      const selectedOptObj = optionsArr.find(o => o.id === selectedId);
      const selectedText = selectedOptObj ? selectedOptObj.text : '';

      const statusIcon = isCorrect 
        ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px;"><polyline points="20 6 9 17 4 12"/></svg>`
        : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      const statusText = isCorrect ? 'Correct' : 'Incorrect';
      const statusColor = isCorrect ? 'var(--success)' : 'var(--danger)';
      const cardBorder = isCorrect ? 'var(--success-border)' : 'var(--danger-border)';

      // Correct Answer Display Logic (Teacher-Controlled)
      let answerRevealHtml = '';
      if (allowCorrectAnswers) {
        let correctText = '';
        if (item.correct_option) {
          const correctOptObj = optionsArr.find(o => o.id === item.correct_option);
          correctText = correctOptObj ? correctOptObj.text : '';
        }

        if (isCorrect) {
          answerRevealHtml = `
            <div style="margin-top: 0.65rem; padding-top: 0.65rem; border-top: 1px dashed var(--border-color); font-size: 0.9rem; color: var(--success);">
              <strong>Correct Answer:</strong> Option ${selectedId} ${selectedText ? `— ${escapeHtml(selectedText)}` : ''}
            </div>
          `;
        } else if (item.correct_option) {
          answerRevealHtml = `
            <div style="margin-top: 0.65rem; padding-top: 0.65rem; border-top: 1px dashed var(--border-color); font-size: 0.9rem; color: var(--warning);">
              <strong>Correct Answer:</strong> Option ${item.correct_option} ${correctText ? `— ${escapeHtml(correctText)}` : ''}
            </div>
          `;
        } else {
          answerRevealHtml = `
            <div style="margin-top: 0.65rem; padding-top: 0.65rem; border-top: 1px dashed var(--border-color); font-size: 0.85rem; color: var(--text-secondary);">
              <em>Answer key is unlocked by instructor for lecture review.</em>
            </div>
          `;
        }
      } else {
        answerRevealHtml = `
          <div style="margin-top: 0.65rem; padding-top: 0.65rem; border-top: 1px dashed var(--border-color); font-size: 0.8rem; color: var(--text-muted);">
            Detailed answer key is hidden by instructor until all class sections have finished.
          </div>
        `;
      }

      return `
        <div class="card" style="margin-bottom: 1.25rem; background: var(--bg-card); border-left: 4px solid ${statusColor}; border-top-color: ${cardBorder}; border-right-color: ${cardBorder}; border-bottom-color: ${cardBorder};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.65rem; flex-wrap: wrap; gap: 0.5rem;">
            <span style="font-weight: 700; font-size: 0.9rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">
              Question ${idx + 1}
            </span>
            <span style="font-weight: 700; font-size: 0.9rem; color: ${statusColor}; display: inline-flex; align-items: center; gap: 0.35rem;">
              ${statusIcon} ${statusText} &bull; ${awarded} / ${possible} pt
            </span>
          </div>

          <div style="font-size: 1.05rem; font-weight: 600; margin-bottom: 0.85rem; color: var(--text-primary); line-height: 1.45;">
            ${escapeHtml(item.question_text)}
          </div>

          <div style="background: #f8fafc; padding: 0.85rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
            <div style="font-size: 0.92rem;">
              <span style="color: var(--text-muted);">Your Selected Answer:</span>
              <strong style="color: ${statusColor}; margin-left: 0.35rem;">
                Option ${selectedId}${selectedText ? `: ${escapeHtml(selectedText)}` : ''}
              </strong>
            </div>
            ${answerRevealHtml}
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Error rendering attempt breakdown:', err);
    container.innerHTML = `<div class="alert alert-danger">Failed to load breakdown: ${err.message}</div>`;
  }
}

// Modal close handlers
document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);
document.getElementById('btn-modal-done')?.addEventListener('click', closeModal);

// Close on backdrop click
document.getElementById('quiz-detail-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'quiz-detail-modal') {
    closeModal();
  }
});

function closeModal() {
  document.getElementById('quiz-detail-modal')?.classList.remove('active');
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

document.addEventListener('DOMContentLoaded', initResultsSection);
