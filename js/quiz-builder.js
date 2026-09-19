/**
 * quiz-builder.js - Dynamic Quiz & Question Editor for Teachers
 */

import { getSupabase, showToast } from './supabase.js';
import { requireAuth } from './auth.js';

let currentTeacher = null;
let editingQuizId = null;
let hasExistingAttempts = false;
let questions = [];

async function initBuilder() {
  currentTeacher = await requireAuth('teacher');
  if (!currentTeacher) return;

  const urlParams = new URLSearchParams(window.location.search);
  editingQuizId = urlParams.get('id');

  // Set minimum date to today in local timezone
  const now = new Date();
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dateInput = document.getElementById('quiz-date');
  dateInput.min = localToday;
  dateInput.value = localToday;

  if (editingQuizId) {
    document.getElementById('builder-page-title').textContent = 'Edit Daily Quiz';
    await loadExistingQuiz(editingQuizId);
  } else {
    // New quiz: add default first question
    addQuestionObject();
    renderQuestionsList();
  }

  setupEventListeners();
}

/**
 * Loads an existing quiz and its questions
 */
async function loadExistingQuiz(quizId) {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    // 1. Fetch Quiz Info
    const { data: quiz, error: qErr } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', quizId)
      .single();

    if (qErr || !quiz) throw new Error('Quiz not found.');

    document.getElementById('quiz-class-number').value = quiz.class_number;
    document.getElementById('quiz-title').value = quiz.title;
    document.getElementById('quiz-date').value = quiz.scheduled_date;
    document.getElementById('quiz-description').value = quiz.description || '';
    document.getElementById('quiz-time-limit').value = quiz.time_limit_minutes || '';
    document.getElementById('quiz-show-score').checked = quiz.show_score_immediately;
    document.getElementById('quiz-show-answers').checked = quiz.show_correct_answers;

    // 2. Check for attempts
    const { count: attemptCount } = await supabase
      .from('quiz_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('quiz_id', quizId);

    if (attemptCount && attemptCount > 0) {
      hasExistingAttempts = true;
      document.getElementById('attempts-warning-banner').style.display = 'block';
      document.getElementById('attempts-count-text').textContent = attemptCount;
      document.getElementById('btn-add-question').disabled = true;
    }

    // 3. Fetch Questions (Teachers have full SELECT on correct_option via RLS)
    const { data: qData, error: questErr } = await supabase
      .from('questions')
      .select('*')
      .eq('quiz_id', quizId)
      .order('order_index', { ascending: true });

    if (questErr) throw questErr;

    if (qData && qData.length > 0) {
      questions = qData.map(q => ({
        id: q.id,
        text: q.question_text,
        marks: q.marks,
        options: q.options || [
          { id: 'A', text: '' },
          { id: 'B', text: '' },
          { id: 'C', text: '' },
          { id: 'D', text: '' }
        ],
        correctOption: q.correct_option || 'A'
      }));
    } else {
      addQuestionObject();
    }

    renderQuestionsList();

  } catch (err) {
    console.error('Error loading quiz:', err);
    showToast('Failed to load quiz: ' + err.message, 'danger');
  }
}

function addQuestionObject() {
  questions.push({
    id: null,
    text: '',
    marks: 1.0,
    options: [
      { id: 'A', text: '' },
      { id: 'B', text: '' },
      { id: 'C', text: '' },
      { id: 'D', text: '' }
    ],
    correctOption: 'A'
  });
}

/**
 * Renders all questions into the container
 */
function renderQuestionsList() {
  const container = document.getElementById('questions-container');
  if (!container) return;

  container.innerHTML = '';

  questions.forEach((q, qIndex) => {
    const card = document.createElement('div');
    card.className = 'question-builder-item';

    card.innerHTML = `
      <div class="question-builder-header">
        <div class="question-drag-title">
          <span>Question ${qIndex + 1}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="display: flex; align-items: center; gap: 0.35rem;">
            <label style="font-size: 0.85rem; color: var(--text-muted);">Points:</label>
            <input type="number" step="0.5" min="0.5" class="form-control q-marks-input" style="width: 75px; padding: 0.35rem 0.6rem;" value="${q.marks}" ${hasExistingAttempts ? 'disabled' : ''}>
          </div>
          ${!hasExistingAttempts && questions.length > 1 ? `
            <button type="button" class="btn btn-outline btn-sm btn-delete-q" style="color: var(--danger); border-color: var(--danger-border);">Delete</button>
          ` : ''}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Question Text</label>
        <textarea class="form-textarea q-text-input" rows="2" placeholder="e.g. Which of the following is a primary key constraint?" required ${hasExistingAttempts ? 'disabled' : ''}>${q.text}</textarea>
      </div>

      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Options & Correct Answer (Select radio for correct answer)</label>
        <div class="options-builder-list">
          ${q.options.map(opt => `
            <div class="option-builder-row">
              <label class="correct-radio-label">
                <input type="radio" name="correct_q_${qIndex}" value="${opt.id}" ${q.correctOption === opt.id ? 'checked' : ''} ${hasExistingAttempts ? 'disabled' : ''}>
                <span>${opt.id}</span>
              </label>
              <input type="text" class="form-control opt-text-input" data-opt-id="${opt.id}" placeholder="Option ${opt.id} text" value="${escapeHtml(opt.text)}" required ${hasExistingAttempts ? 'disabled' : ''}>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Event Bindings for this question card
    const marksInput = card.querySelector('.q-marks-input');
    marksInput.addEventListener('input', (e) => {
      q.marks = parseFloat(e.target.value) || 1.0;
    });

    const textInput = card.querySelector('.q-text-input');
    textInput.addEventListener('input', (e) => {
      q.text = e.target.value;
    });

    const radioInputs = card.querySelectorAll(`input[name="correct_q_${qIndex}"]`);
    radioInputs.forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (e.target.checked) q.correctOption = e.target.value;
      });
    });

    const optInputs = card.querySelectorAll('.opt-text-input');
    optInputs.forEach(optInput => {
      optInput.addEventListener('input', (e) => {
        const optId = e.target.getAttribute('data-opt-id');
        const targetOpt = q.options.find(o => o.id === optId);
        if (targetOpt) targetOpt.text = e.target.value;
      });
    });

    const deleteBtn = card.querySelector('.btn-delete-q');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        questions.splice(qIndex, 1);
        renderQuestionsList();
      });
    }

    container.appendChild(card);
  });
}

function setupEventListeners() {
  document.getElementById('btn-add-question').addEventListener('click', () => {
    addQuestionObject();
    renderQuestionsList();
  });

  document.getElementById('btn-save-draft').addEventListener('click', () => saveQuiz('draft'));
  document.getElementById('btn-publish-quiz').addEventListener('click', () => saveQuiz('published'));
}

/**
 * Saves or updates the quiz and questions
 */
async function saveQuiz(status) {
  const supabase = getSupabase();
  if (!supabase) return;

  // Validate Quiz Metadata
  const classNum = parseInt(document.getElementById('quiz-class-number').value, 10);
  const title = document.getElementById('quiz-title').value.trim();
  const date = document.getElementById('quiz-date').value;
  const desc = document.getElementById('quiz-description').value.trim();
  const timeLimitVal = document.getElementById('quiz-time-limit').value;
  const timeLimit = timeLimitVal ? parseInt(timeLimitVal, 10) : null;
  const showScore = document.getElementById('quiz-show-score').checked;
  const showAnswers = document.getElementById('quiz-show-answers').checked;

  if (!classNum || classNum < 1 || classNum > 35) {
    showToast('Please enter a valid Class number between 1 and 35.', 'warning');
    return;
  }

  if (!title) {
    showToast('Please enter a quiz title / topic.', 'warning');
    return;
  }

  if (!date) {
    showToast('Please select a scheduled date.', 'warning');
    return;
  }

  const now = new Date();
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (!hasExistingAttempts && date < localToday) {
    showToast('Scheduled date cannot be in the past. Please select today or a future date.', 'warning');
    document.getElementById('quiz-date').focus();
    return;
  }

  // Validate Questions if not locked
  if (!hasExistingAttempts) {
    if (questions.length === 0) {
      showToast('Please add at least one question.', 'warning');
      return;
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.text.trim()) {
        showToast(`Please write the prompt for Question ${i + 1}.`, 'warning');
        return;
      }
      for (const opt of q.options) {
        if (!opt.text.trim()) {
          showToast(`Please provide text for Option ${opt.id} in Question ${i + 1}.`, 'warning');
          return;
        }
      }
    }
  }

  const saveBtn = status === 'published' ? document.getElementById('btn-publish-quiz') : document.getElementById('btn-save-draft');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    let quizId = editingQuizId;

    const quizPayload = {
      class_number: classNum,
      title: title,
      description: desc,
      scheduled_date: date,
      status: status,
      time_limit_minutes: timeLimit,
      show_score_immediately: showScore,
      show_correct_answers: showAnswers,
      updated_at: new Date().toISOString()
    };

    if (quizId) {
      // Update existing quiz
      const { error: updErr } = await supabase
        .from('quizzes')
        .update(quizPayload)
        .eq('id', quizId);

      if (updErr) throw updErr;
    } else {
      // Insert new quiz
      quizPayload.created_by = currentTeacher.id;
      const { data: newQuiz, error: insErr } = await supabase
        .from('quizzes')
        .insert(quizPayload)
        .select()
        .single();

      if (insErr) throw insErr;
      quizId = newQuiz.id;
    }

    // Save questions only if not locked
    if (!hasExistingAttempts) {
      // If updating existing quiz, delete old questions first to replace cleanly
      if (editingQuizId) {
        await supabase.from('questions').delete().eq('quiz_id', quizId);
      }

      const questionsToInsert = questions.map((q, idx) => ({
        quiz_id: quizId,
        question_text: q.text.trim(),
        question_type: 'single_choice',
        options: q.options.map(o => ({ id: o.id, text: o.text.trim() })),
        correct_option: q.correctOption,
        marks: q.marks,
        order_index: idx + 1
      }));

      const { error: qInsErr } = await supabase
        .from('questions')
        .insert(questionsToInsert);

      if (qInsErr) throw qInsErr;
    }

    showToast(`Quiz successfully saved as ${status}!`, 'success');
    setTimeout(() => {
      window.location.href = 'admin.html';
    }, 800);

  } catch (err) {
    console.error('Error saving quiz:', err);
    showToast('Failed to save quiz: ' + err.message, 'danger');
    saveBtn.disabled = false;
    saveBtn.textContent = status === 'published' ? 'Publish Quiz' : 'Save as Draft';
  }
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

document.addEventListener('DOMContentLoaded', initBuilder);
