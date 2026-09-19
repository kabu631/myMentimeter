/**
 * ==============================================================================
 * js/quiz-runner.js - Secure Student Quiz Taking Engine
 * ==============================================================================
 * Implements all 17 requirements:
 * - Verifies student authentication & single attempt constraint
 * - Hides answer keys from client DevTools
 * - Coordinates timer, navigation, and answered state
 * - Submits answers to Supabase RPC 'submit_quiz' for database-side grading
 * - Displays verified final score: "Score: X / Y"
 */

import { getSupabase, showToast } from './supabase.js';
import { requireAuth } from './auth.js';

let currentUser = null;
let currentQuiz = null;
let questions = [];
let currentIndex = 0;
let userAnswers = {}; // Map: { question_id: 'A' }
let timerInterval = null;
let secondsRemaining = 0;
let isSubmitted = false;

async function initQuizEngine() {
  // 1. Verify student is authenticated
  currentUser = await requireAuth('student');
  if (!currentUser) return;

  const urlParams = new URLSearchParams(window.location.search);
  let quizId = urlParams.get('id');

  const supabase = getSupabase();
  if (!supabase) return;

  try {
    // 2. If no ID provided, find the active published quiz
    if (!quizId) {
      const { data: latestQuiz } = await supabase
        .from('quizzes')
        .select('id')
        .eq('status', 'published')
        .order('scheduled_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestQuiz) {
        quizId = latestQuiz.id;
      }
    }

    if (!quizId) {
      showErrorState('No Active Quiz Found', 'There is currently no published quiz available for submission.');
      return;
    }

    // 3. Load the selected quiz & verify it is published
    const { data: quiz, error: quizErr } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', quizId)
      .single();

    if (quizErr || !quiz) {
      showErrorState('Quiz Inaccessible', 'The requested quiz was not found or has been removed.');
      return;
    }

    currentQuiz = quiz;

    // 4. Verify student has not already attempted it
    const { data: existingAttempt, error: attErr } = await supabase
      .from('quiz_attempts')
      .select('id, score, total_marks')
      .eq('quiz_id', quizId)
      .eq('student_id', currentUser.id)
      .maybeSingle();

    if (attErr) throw attErr;

    if (existingAttempt) {
      // Prevent a second attempt and display the already achieved score
      showCompletionCard(existingAttempt.score, existingAttempt.total_marks, 'You have already attempted this quiz.');
      return;
    }

    if (quiz.status !== 'published') {
      showErrorState('Quiz Closed', 'This quiz is not currently accepting submissions.');
      return;
    }

    // 5. Fetch questions strictly WITHOUT `correct_option` (Anti-cheat guarantee)
    let qList = null;
    let qErr = null;

    // Use student_questions view first (safe from exposing correct_option and accessible by student RLS)
    const sqRes = await supabase
      .from('student_questions')
      .select('id, quiz_id, question_text, question_type, options, marks, order_index')
      .eq('quiz_id', quizId)
      .order('order_index', { ascending: true });

    if (sqRes.data && sqRes.data.length > 0) {
      qList = sqRes.data;
    } else {
      // Fallback in case student_questions view is not yet created
      const qRes = await supabase
        .from('questions')
        .select('id, quiz_id, question_text, question_type, options, marks, order_index')
        .eq('quiz_id', quizId)
        .order('order_index', { ascending: true });
      qList = qRes.data;
      qErr = qRes.error;
    }

    if (!qList || qList.length === 0) {
      showErrorState('No Questions', 'This quiz does not contain any questions yet.');
      return;
    }

    questions = qList;

    // Update Header Metadata
    const headerTitle = document.getElementById('quiz-header-title');
    if (headerTitle) headerTitle.textContent = currentQuiz.title;
    const sublineTitle = document.getElementById('quiz-subline-title');
    if (sublineTitle) sublineTitle.textContent = currentQuiz.title;
    const classBadge = document.getElementById('quiz-class-badge');
    if (classBadge) classBadge.textContent = `Class ${String(currentQuiz.class_number).padStart(2, '0')}`;
    const topSubmit = document.getElementById('btn-top-submit');
    if (topSubmit) topSubmit.style.display = 'inline-flex';

    // Timer setup if configured
    const timerPill = document.getElementById('quiz-timer-pill');
    if (currentQuiz.time_limit_minutes && currentQuiz.time_limit_minutes > 0) {
      secondsRemaining = currentQuiz.time_limit_minutes * 60;
      startCountdownTimer();
    } else if (timerPill) {
      timerPill.style.display = 'none';
    }

    // Reveal the active quiz engine
    const loadingState = document.getElementById('quiz-loading-state');
    if (loadingState) loadingState.style.display = 'none';
    const activeEngine = document.getElementById('quiz-active-engine');
    if (activeEngine) activeEngine.style.display = 'block';

    // Render palette & initial question
    renderNavigatorPalette();
    renderCurrentQuestion(0);
    setupControlEvents();

  } catch (err) {
    console.error('Quiz init error:', err);
    showErrorState('Error Loading Quiz', err.message);
  }
}

/**
 * Starts the countdown timer
 */
function startCountdownTimer() {
  const timerDisplay = document.getElementById('timer-countdown');
  const timerPill = document.getElementById('quiz-timer-pill');

  function tick() {
    const mins = Math.floor(secondsRemaining / 60);
    const secs = secondsRemaining % 60;
    timerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (secondsRemaining <= 60) {
      timerPill.classList.add('timer-warning');
    }

    if (secondsRemaining <= 0) {
      clearInterval(timerInterval);
      showToast('Time is up! Submitting your answers now...', 'warning');
      submitQuizToDatabase();
    } else {
      secondsRemaining--;
    }
  }

  tick();
  timerInterval = setInterval(tick, 1000);
}

/**
 * Renders the question at index (e.g. "Question 4 of 10")
 */
function renderCurrentQuestion(index) {
  if (index < 0 || index >= questions.length) return;
  currentIndex = index;

  const q = questions[index];

  // 10. Display Quiz Progress
  document.getElementById('q-counter-current').textContent = index + 1;
  document.getElementById('q-counter-total').textContent = questions.length;
  document.getElementById('question-index-tag').textContent = `Question ${index + 1} of ${questions.length}`;
  document.getElementById('question-points-tag').textContent = `${Number(q.marks).toFixed(1)} pt`;

  const progressPct = Math.round(((index + 1) / questions.length) * 100);
  const fillEl = document.getElementById('quiz-progress-fill');
  if (fillEl) {
    fillEl.style.width = `${progressPct}%`;
    fillEl.setAttribute('aria-valuenow', progressPct);
  }

  const badgeEl = document.getElementById('quiz-percentage-badge');
  if (badgeEl) {
    badgeEl.textContent = `${progressPct}% Complete`;
  }

  // 9. Show answered/unanswered state
  const answeredCount = Object.keys(userAnswers).length;
  const statusLabel = document.getElementById('answered-status-label');
  if (statusLabel) {
    statusLabel.textContent = `${answeredCount} of ${questions.length} answered`;
    if (answeredCount === questions.length) {
      statusLabel.className = 'badge badge-published';
    } else {
      statusLabel.className = 'badge badge-primary';
    }
  }

  // 5. Display Question Prompt
  document.getElementById('question-prompt').textContent = q.question_text;

  // 6. Display Four Multiple-Choice Options with Radio Indicator
  const optionsBox = document.getElementById('options-container');
  optionsBox.innerHTML = '';

  const opts = Array.isArray(q.options) ? q.options : [];
  const selectedChoice = userAnswers[q.id];

  opts.forEach(opt => {
    const isSelected = (selectedChoice === opt.id);
    const card = document.createElement('div');
    card.className = `option-card ${isSelected ? 'selected' : ''}`;
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    card.tabIndex = 0;

    // Radio icon: ● if selected, ○ if unselected
    const radioSymbol = isSelected ? '●' : '○';

    card.innerHTML = `
      <div class="option-key" style="font-size: 1.1rem; display: flex; align-items: center; gap: 0.35rem;">
        <span style="font-size: 1.25rem;">${radioSymbol}</span>
        <span>${opt.id}.</span>
      </div>
      <div class="option-text">${escapeHtml(opt.text)}</div>
    `;

    // 7. Allow only one answer per question
    const selectThisOption = () => {
      userAnswers[q.id] = opt.id;
      renderCurrentQuestion(currentIndex);
      renderNavigatorPalette();
    };

    card.addEventListener('click', selectThisOption);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectThisOption();
      }
    });

    optionsBox.appendChild(card);
  });

  // 8. Navigation Controls
  document.getElementById('btn-prev').disabled = (index === 0);
  const nextBtn = document.getElementById('btn-next');
  if (index === questions.length - 1) {
    nextBtn.textContent = 'Review & Submit →';
    nextBtn.classList.remove('btn-primary');
    nextBtn.classList.add('btn-success');
  } else {
    nextBtn.textContent = 'Next →';
    nextBtn.classList.remove('btn-success');
    nextBtn.classList.add('btn-primary');
  }

  renderNavigatorPalette();
}

/**
 * Renders the question navigation palette (green for answered, muted for unanswered)
 */
function renderNavigatorPalette() {
  const grid = document.getElementById('palette-grid');
  if (!grid) return;
  grid.innerHTML = '';

  questions.forEach((q, idx) => {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.textContent = idx + 1;

    if (idx === currentIndex) {
      item.classList.add('current');
    }

    if (userAnswers[q.id]) {
      item.classList.add('answered');
    }

    item.addEventListener('click', () => renderCurrentQuestion(idx));
    grid.appendChild(item);
  });
}

function setupControlEvents() {
  // [Previous] button
  document.getElementById('btn-prev').addEventListener('click', () => {
    if (currentIndex > 0) renderCurrentQuestion(currentIndex - 1);
  });

  // [Next] button
  document.getElementById('btn-next').addEventListener('click', () => {
    if (currentIndex < questions.length - 1) {
      renderCurrentQuestion(currentIndex + 1);
    } else {
      openConfirmationModal();
    }
  });

  // [Submit Quiz] buttons
  document.getElementById('btn-bottom-submit').addEventListener('click', openConfirmationModal);
  document.getElementById('btn-top-submit').addEventListener('click', openConfirmationModal);

  // 12. Confirm before final submission modal controls
  document.getElementById('btn-modal-cancel').addEventListener('click', () => {
    document.getElementById('submit-modal').classList.remove('active');
  });

  document.getElementById('btn-modal-confirm').addEventListener('click', submitQuizToDatabase);

  // Anti-accidental tab close warning
  window.addEventListener('beforeunload', (e) => {
    if (!isSubmitted && Object.keys(userAnswers).length > 0) {
      e.preventDefault();
      e.returnValue = 'You have an active quiz session in progress. Are you sure you want to leave?';
    }
  });
}

/**
 * 12. Opens confirmation modal before final submission
 */
function openConfirmationModal() {
  const answeredCount = Object.keys(userAnswers).length;
  const totalCount = questions.length;
  const unansweredCount = totalCount - answeredCount;

  document.getElementById('modal-answered-summary').textContent = `${answeredCount} of ${totalCount}`;

  const unansweredAlert = document.getElementById('modal-unanswered-alert');
  if (unansweredCount > 0) {
    unansweredAlert.textContent = `You have ${unansweredCount} unanswered question(s). Only questions with chosen answers can earn points.`;
    unansweredAlert.style.display = 'block';
  } else {
    unansweredAlert.style.display = 'none';
  }

  document.getElementById('submit-modal').classList.add('active');
}

/**
 * 14. Save attempt, 15. Save answers, 16. Calculate score securely
 * Calls PostgreSQL Stored Procedure 'submit_quiz'
 */
async function submitQuizToDatabase() {
  const supabase = getSupabase();
  const confirmBtn = document.getElementById('btn-modal-confirm');

  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Evaluating & Grading Quiz...';
  }

  // Format student choices into clean JSON array
  const formattedAnswers = questions.map(q => ({
    question_id: q.id,
    selected_option: userAnswers[q.id] || null
  }));

  try {
    clearInterval(timerInterval);

    // Call database-level evaluation procedure
    const { data: result, error } = await supabase.rpc('submit_quiz', {
      p_quiz_id: currentQuiz.id,
      p_answers: formattedAnswers
    });

    if (error) throw error;

    if (!result || !result.success) {
      throw new Error(result?.error || 'Database submission error.');
    }

    isSubmitted = true;
    document.getElementById('submit-modal').classList.remove('active');
    showToast('Quiz evaluated and submitted successfully!', 'success');

    // 17. Display final score immediately
    showCompletionCard(result.score, result.total_marks);

  } catch (err) {
    console.error('Submission error:', err);
    showToast(err.message || 'Failed to submit quiz.', 'danger');
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm & Submit Score';
    }
  }
}

/**
 * 17. Displays the final score card (e.g. "Score: 8 / 10")
 */
function showCompletionCard(score, totalMarks, message = null) {
  const loadingState = document.getElementById('quiz-loading-state');
  if (loadingState) loadingState.style.display = 'none';
  const activeEngine = document.getElementById('quiz-active-engine');
  if (activeEngine) activeEngine.style.display = 'none';
  const topSubmit = document.getElementById('btn-top-submit');
  if (topSubmit) topSubmit.style.display = 'none';

  const completionBox = document.getElementById('quiz-completion-state');
  if (completionBox) completionBox.style.display = 'block';

  if (currentQuiz) {
    document.getElementById('completion-quiz-title').textContent = currentQuiz.title;
    document.getElementById('completion-class-badge').textContent = `Class ${String(currentQuiz.class_number).padStart(2, '0')}`;
  }

  const s = Number(score || 0);
  const t = Number(totalMarks || 0);
  const pct = t > 0 ? Math.round((s / t) * 100) : 0;

  document.getElementById('completion-score').textContent = s.toFixed(1);
  document.getElementById('completion-total').textContent = t.toFixed(1);
  document.getElementById('completion-accuracy').textContent = `${pct}% Accuracy`;

  if (message) {
    showToast(message, 'info');
  }
}

function showErrorState(title, message) {
  const loadingState = document.getElementById('quiz-loading-state');
  if (loadingState) loadingState.style.display = 'none';
  const activeEngine = document.getElementById('quiz-active-engine');
  if (activeEngine) activeEngine.style.display = 'none';
  const topSubmit = document.getElementById('btn-top-submit');
  if (topSubmit) topSubmit.style.display = 'none';

  const errBox = document.getElementById('quiz-error-state');
  const errTitle = document.getElementById('quiz-error-title');
  if (errTitle) errTitle.textContent = title;
  const errMsg = document.getElementById('quiz-error-message');
  if (errMsg) errMsg.textContent = message;
  if (errBox) errBox.style.display = 'block';
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

document.addEventListener('DOMContentLoaded', initQuizEngine);
