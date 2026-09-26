/**
 * ==============================================================================
 * js/quiz-runner.js - Secure Student Quiz Taking Engine
 * ==============================================================================
 * - Only enrolled students can load a quiz (RLS), and only once (single attempt)
 * - Questions come from the student_questions view, which has no answer keys
 * - Countdown respects both the time limit and the quiz's automatic close time
 * - Answers and the start time survive a page refresh (saved in localStorage)
 * - Submission is graded by the submit_quiz() database function
 */

import { getSupabase, showToast } from './supabase.js';
import { requireAuth } from './auth.js';
import {
  escapeHtml, fmtNum, fmtPct, classLabel, courseLabel, percentOf, pctBadgeClass,
  isQuizClosed, isScoreVisible, friendlyError
} from './utils.js';

let currentUser = null;
let currentQuiz = null;
let currentCourse = null;
let questions = [];
let currentIndex = 0;
let userAnswers = {}; // { question_id: 'A' }
let timerInterval = null;
let deadline = null;  // ms timestamp, or null when untimed
let isSubmitted = false;
let isSubmitting = false;

const $ = (id) => document.getElementById(id);
const storageKey = () => `dcq_progress_${currentUser.id}_${currentQuiz.id}`;

async function initQuizEngine() {
  currentUser = await requireAuth('student');
  if (!currentUser) return;

  const quizId = new URLSearchParams(window.location.search).get('id');
  if (!quizId) {
    window.location.replace('dashboard.html');
    return;
  }

  const supabase = getSupabase();

  try {
    const { data: quiz, error: quizErr } = await supabase
      .from('quizzes')
      .select('*, courses (id, code, name, section)')
      .eq('id', quizId)
      .maybeSingle();

    if (quizErr) throw quizErr;
    if (!quiz) {
      showErrorState('Quiz not available', 'This quiz was not found, is not published yet, or belongs to a course you have not joined.');
      return;
    }

    currentQuiz = quiz;
    currentCourse = quiz.courses;
    document.title = `${quiz.title} | DailyClassQuiz`;

    const { data: existingAttempt, error: attErr } = await supabase
      .from('quiz_attempts')
      .select('id, score, total_marks')
      .eq('quiz_id', quizId)
      .eq('student_id', currentUser.id)
      .maybeSingle();
    if (attErr) throw attErr;

    if (existingAttempt) {
      showCompletionCard(existingAttempt);
      showToast('You have already submitted this quiz.', 'info');
      return;
    }

    if (quiz.status !== 'published' || isQuizClosed(quiz)) {
      showErrorState('Quiz closed', 'This quiz is no longer accepting submissions.');
      return;
    }

    const { data: qList, error: qErr } = await supabase
      .from('student_questions')
      .select('id, question_text, question_type, options, marks, order_index')
      .eq('quiz_id', quizId)
      .order('order_index', { ascending: true });
    if (qErr) throw qErr;

    if (!qList || qList.length === 0) {
      showErrorState('No questions yet', 'Your teacher has not added questions to this quiz.');
      return;
    }

    questions = qList;
    restoreProgress();

    $('quiz-header-title').textContent = currentCourse?.code || 'Daily Quiz';
    $('quiz-subline-title').textContent = `${quiz.title} · ${courseLabel(currentCourse)}`;
    $('quiz-class-badge').textContent = classLabel(quiz.class_number);
    $('btn-top-submit').classList.remove('hidden');

    setupDeadline();

    $('quiz-loading-state').classList.add('hidden');
    $('quiz-active-engine').classList.remove('hidden');

    renderCurrentQuestion(0);
    setupControlEvents();
  } catch (err) {
    console.error('Quiz init error:', err);
    showErrorState('Error loading quiz', friendlyError(err));
  }
}

// ------------------------------------------------------------------------------
// Progress persistence (so a refresh or dropped connection doesn't lose answers)
// ------------------------------------------------------------------------------

function restoreProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey()) || 'null');
    if (saved && typeof saved === 'object') {
      const validIds = new Set(questions.map(q => q.id));
      userAnswers = Object.fromEntries(Object.entries(saved.answers || {}).filter(([id]) => validIds.has(id)));
      if (saved.startedAt) currentQuiz._startedAt = saved.startedAt;
    }
  } catch {
    // ignore corrupt storage
  }
  if (!currentQuiz._startedAt) currentQuiz._startedAt = Date.now();
  saveProgress();
}

function saveProgress() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify({ answers: userAnswers, startedAt: currentQuiz._startedAt }));
  } catch {
    // storage full or blocked; the quiz still works
  }
}

function clearProgress() {
  try { localStorage.removeItem(storageKey()); } catch { /* ignore */ }
}

// ------------------------------------------------------------------------------
// Timer
// ------------------------------------------------------------------------------

function setupDeadline() {
  const limits = [];
  if (currentQuiz.time_limit_minutes > 0) {
    limits.push(currentQuiz._startedAt + currentQuiz.time_limit_minutes * 60 * 1000);
  }
  if (currentQuiz.closes_at) {
    limits.push(new Date(currentQuiz.closes_at).getTime());
  }
  if (limits.length === 0) return;

  deadline = Math.min(...limits);
  $('quiz-timer-pill').classList.remove('hidden');
  tick();
  timerInterval = setInterval(tick, 1000);
}

function tick() {
  const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
  const hrs = Math.floor(remaining / 3600);
  const mins = Math.floor((remaining % 3600) / 60);
  const secs = remaining % 60;
  $('timer-countdown').textContent = hrs > 0
    ? `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  if (remaining <= 60) $('quiz-timer-pill').classList.add('timer-warning');

  if (remaining <= 0) {
    clearInterval(timerInterval);
    if (!isSubmitted && !isSubmitting) {
      showToast('Time is up! Submitting your answers now...', 'warning');
      submitQuizToDatabase();
    }
  }
}

// ------------------------------------------------------------------------------
// Rendering
// ------------------------------------------------------------------------------

function renderCurrentQuestion(index) {
  if (index < 0 || index >= questions.length) return;
  currentIndex = index;
  const q = questions[index];
  const total = questions.length;

  $('q-counter-current').textContent = index + 1;
  $('q-counter-total').textContent = total;
  $('question-index-tag').textContent = `Question ${index + 1} of ${total}`;
  $('question-points-tag').textContent = `${fmtNum(q.marks)} mark${Number(q.marks) === 1 ? '' : 's'}`;

  const answeredCount = Object.keys(userAnswers).length;
  const progressPct = Math.round((answeredCount / total) * 100);
  $('quiz-progress-fill').style.width = `${progressPct}%`;
  $('quiz-progress-fill').setAttribute('aria-valuenow', progressPct);
  const statusLabel = $('answered-status-label');
  statusLabel.textContent = `${answeredCount} of ${total} answered`;
  statusLabel.className = `badge ${answeredCount === total ? 'badge-published' : 'badge-primary'}`;

  $('question-prompt').textContent = q.question_text;

  const optionsBox = $('options-container');
  optionsBox.innerHTML = '';
  const selected = userAnswers[q.id];

  (Array.isArray(q.options) ? q.options : []).forEach(opt => {
    const isSelected = selected === opt.id;
    const card = document.createElement('div');
    card.className = `option-card ${isSelected ? 'selected' : ''}`;
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(isSelected));
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="option-key">${escapeHtml(opt.id)}</div>
      <div class="option-text">${escapeHtml(opt.text)}</div>
    `;
    const choose = () => selectOption(opt.id);
    card.addEventListener('click', choose);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose();
      }
    });
    optionsBox.appendChild(card);
  });

  $('btn-prev').disabled = index === 0;
  const nextBtn = $('btn-next');
  const isLast = index === total - 1;
  nextBtn.textContent = isLast ? 'Review & Submit →' : 'Next →';
  nextBtn.classList.toggle('btn-success', isLast);
  nextBtn.classList.toggle('btn-primary', !isLast);

  renderNavigatorPalette();
}

function selectOption(optionId) {
  const q = questions[currentIndex];
  userAnswers[q.id] = optionId;
  saveProgress();
  renderCurrentQuestion(currentIndex);
}

function renderNavigatorPalette() {
  const grid = $('palette-grid');
  grid.innerHTML = '';
  questions.forEach((q, idx) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'palette-item';
    item.textContent = idx + 1;
    item.setAttribute('aria-label', `Question ${idx + 1}${userAnswers[q.id] ? ', answered' : ''}`);
    if (userAnswers[q.id]) item.classList.add('answered');
    if (idx === currentIndex) item.classList.add('current');
    item.addEventListener('click', () => renderCurrentQuestion(idx));
    grid.appendChild(item);
  });
}

function setupControlEvents() {
  $('btn-prev').addEventListener('click', () => renderCurrentQuestion(currentIndex - 1));
  $('btn-next').addEventListener('click', () => {
    if (currentIndex < questions.length - 1) renderCurrentQuestion(currentIndex + 1);
    else openConfirmationModal();
  });
  $('btn-bottom-submit').addEventListener('click', openConfirmationModal);
  $('btn-top-submit').addEventListener('click', openConfirmationModal);
  $('btn-modal-cancel').addEventListener('click', () => $('submit-modal').classList.remove('active'));
  $('btn-modal-confirm').addEventListener('click', submitQuizToDatabase);

  document.addEventListener('keydown', (e) => {
    if (isSubmitted || $('submit-modal').classList.contains('active')) return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'ArrowRight' && currentIndex < questions.length - 1) renderCurrentQuestion(currentIndex + 1);
    else if (e.key === 'ArrowLeft' && currentIndex > 0) renderCurrentQuestion(currentIndex - 1);
    else if (/^[a-f]$/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const opt = (questions[currentIndex].options || []).find(o => o.id.toLowerCase() === e.key.toLowerCase());
      if (opt) selectOption(opt.id);
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (!isSubmitted && Object.keys(userAnswers).length > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

function openConfirmationModal() {
  const answered = Object.keys(userAnswers).length;
  const total = questions.length;
  $('modal-answered-summary').textContent = `${answered} of ${total}`;

  const alert = $('modal-unanswered-alert');
  if (answered < total) {
    alert.textContent = `${total - answered} question(s) are unanswered. Unanswered questions score zero.`;
    alert.classList.remove('hidden');
  } else {
    alert.classList.add('hidden');
  }
  $('submit-modal').classList.add('active');
}

async function submitQuizToDatabase() {
  if (isSubmitting || isSubmitted) return;
  isSubmitting = true;

  const confirmBtn = $('btn-modal-confirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Grading...';

  const answers = questions.map(q => ({ question_id: q.id, selected_option: userAnswers[q.id] || null }));

  try {
    const { data: result, error } = await getSupabase().rpc('submit_quiz', {
      p_quiz_id: currentQuiz.id,
      p_answers: answers
    });
    if (error) throw error;
    if (!result?.success) throw new Error(result?.error || 'Submission failed.');

    isSubmitted = true;
    clearInterval(timerInterval);
    clearProgress();
    $('submit-modal').classList.remove('active');
    showToast('Quiz submitted and graded!', 'success');
    showCompletionCard({ id: result.attempt_id, score: result.score, total_marks: result.total_marks });
  } catch (err) {
    console.error('Submission error:', err);
    showToast(friendlyError(err), 'danger');
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Submit & get score';
    // Already submitted elsewhere, or the quiz closed: nothing left to retry
    if (/already submitted|closed/i.test(err.message || '')) {
      isSubmitted = true;
      clearProgress();
      setTimeout(() => window.location.replace('dashboard.html'), 1500);
    }
  } finally {
    isSubmitting = false;
  }
}

function showCompletionCard(attempt) {
  $('quiz-loading-state').classList.add('hidden');
  $('quiz-active-engine').classList.add('hidden');
  $('btn-top-submit').classList.add('hidden');
  $('quiz-completion-state').classList.remove('hidden');

  $('completion-quiz-title').textContent = currentQuiz.title;
  $('completion-class-badge').textContent = `${classLabel(currentQuiz.class_number)} · Submitted`;
  $('completion-course').textContent = courseLabel(currentCourse);
  if (attempt.id) $('completion-review-link').href = `results.html?attempt=${attempt.id}`;

  if (isScoreVisible(currentQuiz)) {
    const s = Number(attempt.score || 0);
    const t = Number(attempt.total_marks || 0);
    const pct = percentOf(s, t);
    $('completion-score').textContent = fmtNum(s);
    $('completion-total').textContent = fmtNum(t);
    const badge = $('completion-accuracy');
    badge.textContent = fmtPct(pct, 0);
    badge.className = `badge ${pctBadgeClass(pct)}`;
    $('completion-message').textContent = pct >= 90 ? 'Excellent work!'
      : pct >= 70 ? 'Great job!'
      : pct >= 50 ? 'Good effort!'
      : 'Keep practising — review the answers once the quiz closes.';
  } else {
    $('completion-score-box').classList.add('hidden');
    $('completion-hidden-note').classList.remove('hidden');
  }
}

function showErrorState(title, message) {
  $('quiz-loading-state').classList.add('hidden');
  $('quiz-active-engine').classList.add('hidden');
  $('btn-top-submit').classList.add('hidden');
  $('quiz-error-title').textContent = title;
  $('quiz-error-message').textContent = message;
  $('quiz-error-state').classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', initQuizEngine);
