/**
 * ==============================================================================
 * js/quiz-builder.js - Create / edit a quiz and its questions
 * ==============================================================================
 * URL: create-quiz.html?course=<id> (new) or create-quiz.html?id=<quizId> (edit)
 * Saves through the save_quiz() database function so the quiz and all of its
 * questions are written in a single transaction.
 */

import { getSupabase, showToast } from './supabase.js';
import { guardAdminPage, loadTeacherCourses, pickActiveCourseId, rememberActiveCourse, noCoursesHtml } from './admin-service.js';
import { escapeHtml, courseLabel, todayIso, toLocalInput, fromLocalInput, fmtNum, friendlyError } from './utils.js';

const OPTION_IDS = ['A', 'B', 'C', 'D', 'E', 'F'];
const $ = (id) => document.getElementById(id);

let courses = [];
let editingQuiz = null;
let isLocked = false;
let questions = [];
let isDirty = false;
let isSaving = false;

function blankQuestion(type = 'single_choice') {
  if (type === 'true_false') {
    return { type, text: '', marks: 1, correct: 'A', options: [{ id: 'A', text: 'True' }, { id: 'B', text: 'False' }] };
  }
  return { type, text: '', marks: 1, correct: 'A', options: OPTION_IDS.slice(0, 4).map(id => ({ id, text: '' })) };
}

async function initBuilder() {
  const teacher = await guardAdminPage();
  if (!teacher) return;

  try {
    courses = await loadTeacherCourses();
  } catch (err) {
    showToast(friendlyError(err), 'danger');
    return;
  }

  if (courses.length === 0) {
    $('no-course').innerHTML = noCoursesHtml();
    $('no-course').classList.remove('hidden');
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const quizId = params.get('id');

  const select = $('field-course');
  courses.forEach(c => select.add(new Option(courseLabel(c) + (c.is_archived ? ' — archived' : ''), c.id)));

  if (quizId) {
    const ok = await loadQuiz(quizId);
    if (!ok) return;
  } else {
    select.value = pickActiveCourseId(courses);
    $('field-date').value = todayIso();
    await suggestClassNumber();
    questions = [blankQuestion()];
  }

  updateBackLinks();
  $('builder').classList.remove('hidden');
  renderQuestions();
  setupEvents();
}

async function loadQuiz(quizId) {
  const supabase = getSupabase();
  const { data: quiz, error } = await supabase.from('quizzes').select('*, quiz_attempts(count)').eq('id', quizId).maybeSingle();
  if (error || !quiz) {
    showToast(error ? friendlyError(error) : 'Quiz not found, or it belongs to another teacher.', 'danger');
    return false;
  }

  editingQuiz = quiz;
  const attemptCount = quiz.quiz_attempts?.[0]?.count || 0;
  isLocked = attemptCount > 0;

  $('page-heading').textContent = 'Edit Quiz';
  $('field-course').value = quiz.course_id;
  $('field-course').disabled = isLocked;
  $('field-class-number').value = quiz.class_number;
  $('field-title').value = quiz.title;
  $('field-date').value = quiz.scheduled_date;
  $('field-time-limit').value = quiz.time_limit_minutes || '';
  $('field-description').value = quiz.description || '';
  $('field-closes-at').value = toLocalInput(quiz.closes_at);
  $('field-show-score').checked = quiz.show_score_immediately;
  $('field-show-answers').checked = quiz.show_correct_answers;
  $('btn-save-publish').innerHTML = { draft: 'Publish now &rarr;', published: 'Save &amp; keep published', closed: 'Save changes' }[quiz.status];
  $('btn-save-draft').textContent = quiz.status === 'draft' ? 'Save as draft' : 'Move to drafts';
  if (isLocked) {
    $('btn-save-draft').classList.add('hidden');
    $('locked-warning').classList.remove('hidden');
    $('locked-attempt-count').textContent = attemptCount;
    ['btn-add-q', 'btn-add-tf', 'btn-add-q-bottom'].forEach(id => $(id).classList.add('hidden'));
  }

  const { data: qData } = await supabase.from('questions').select('*').eq('quiz_id', quizId).order('order_index', { ascending: true });
  questions = (qData || []).map(q => ({
    type: q.question_type,
    text: q.question_text,
    marks: Number(q.marks),
    correct: q.correct_option,
    options: (q.options || []).map(o => ({ id: o.id, text: o.text }))
  }));
  if (questions.length === 0) questions = [blankQuestion()];
  return true;
}

async function suggestClassNumber() {
  const courseId = $('field-course').value;
  const { data } = await getSupabase()
    .from('quizzes')
    .select('class_number')
    .eq('course_id', courseId)
    .order('class_number', { ascending: false })
    .limit(1);
  $('field-class-number').value = (data?.[0]?.class_number || 0) + 1;
}

function updateBackLinks() {
  const url = `quizzes.html?course=${$('field-course').value}`;
  $('back-link').href = url;
  $('btn-cancel').href = url;
}

// ------------------------------------------------------------------------------
// Question list
// ------------------------------------------------------------------------------

function renderQuestions() {
  const container = $('questions-list-container');
  container.innerHTML = '';
  const dis = isLocked ? 'disabled' : '';

  questions.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'question-builder-item';
    const isTF = q.type === 'true_false';

    card.innerHTML = `
      <div class="question-builder-header">
        <div class="question-drag-title">Question ${idx + 1} <span class="badge badge-draft">${isTF ? 'True / False' : 'Multiple choice'}</span></div>
        <div class="toolbar" style="gap: 0.4rem;">
          <label class="small muted" for="marks-${idx}">Marks</label>
          <input id="marks-${idx}" type="number" step="0.5" min="0.5" max="99" class="form-control q-marks" style="width: 80px; padding: 0.35rem 0.6rem;" value="${q.marks}" ${dis}>
          ${isLocked ? '' : `
            <button type="button" class="icon-btn" data-move="-1" title="Move up" aria-label="Move up" ${idx === 0 ? 'disabled' : ''}>&uarr;</button>
            <button type="button" class="icon-btn" data-move="1" title="Move down" aria-label="Move down" ${idx === questions.length - 1 ? 'disabled' : ''}>&darr;</button>
            <button type="button" class="icon-btn" data-duplicate title="Duplicate" aria-label="Duplicate">⧉</button>
            ${questions.length > 1 ? '<button type="button" class="btn btn-danger-outline btn-sm" data-delete>Delete</button>' : ''}
          `}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="prompt-${idx}">Question *</label>
        <textarea id="prompt-${idx}" class="form-textarea q-prompt" rows="2" placeholder="Type the question..." ${dis}>${escapeHtml(q.text)}</textarea>
      </div>

      <div class="form-group" style="margin-bottom: 0;">
        <span class="form-label">Options — select the correct answer</span>
        <div class="options-builder-list">
          ${q.options.map((opt, oIdx) => `
            <div class="option-builder-row">
              <label class="correct-radio-label">
                <input type="radio" name="correct_${idx}" value="${opt.id}" ${q.correct === opt.id ? 'checked' : ''} ${dis}>
                <span>${opt.id}</span>
              </label>
              <input type="text" class="form-control opt-input" data-opt="${oIdx}" placeholder="Option ${opt.id}" value="${escapeHtml(opt.text)}" ${isTF || isLocked ? 'disabled' : ''}>
              ${!isTF && !isLocked && q.options.length > 2 ? `<button type="button" class="icon-btn" data-remove-opt="${oIdx}" title="Remove option" aria-label="Remove option ${opt.id}">&times;</button>` : ''}
            </div>
          `).join('')}
        </div>
        ${!isTF && !isLocked && q.options.length < OPTION_IDS.length ? '<button type="button" class="link-button" data-add-opt>+ Add option</button>' : ''}
      </div>
    `;

    card.querySelector('.q-marks').addEventListener('input', (e) => { q.marks = parseFloat(e.target.value) || 0; markDirty(); updateSummary(); });
    card.querySelector('.q-prompt').addEventListener('input', (e) => { q.text = e.target.value; markDirty(); });
    card.querySelectorAll(`input[name="correct_${idx}"]`).forEach(r => r.addEventListener('change', (e) => { q.correct = e.target.value; markDirty(); }));
    card.querySelectorAll('.opt-input').forEach(inp => inp.addEventListener('input', (e) => { q.options[Number(e.target.dataset.opt)].text = e.target.value; markDirty(); }));

    card.querySelectorAll('[data-move]').forEach(btn => btn.addEventListener('click', () => {
      const to = idx + Number(btn.dataset.move);
      [questions[idx], questions[to]] = [questions[to], questions[idx]];
      markDirty();
      renderQuestions();
    }));
    card.querySelector('[data-duplicate]')?.addEventListener('click', () => {
      questions.splice(idx + 1, 0, structuredClone(q));
      markDirty();
      renderQuestions();
    });
    card.querySelector('[data-delete]')?.addEventListener('click', () => {
      if ((q.text.trim() || q.options.some(o => o.text.trim())) && !confirm(`Delete question ${idx + 1}?`)) return;
      questions.splice(idx, 1);
      markDirty();
      renderQuestions();
    });
    card.querySelector('[data-add-opt]')?.addEventListener('click', () => {
      q.options.push({ id: OPTION_IDS[q.options.length], text: '' });
      markDirty();
      renderQuestions();
    });
    card.querySelectorAll('[data-remove-opt]').forEach(btn => btn.addEventListener('click', () => {
      q.options.splice(Number(btn.dataset.removeOpt), 1);
      q.options.forEach((o, i) => { o.id = OPTION_IDS[i]; });   // keep letters contiguous
      if (!q.options.some(o => o.id === q.correct)) q.correct = 'A';
      markDirty();
      renderQuestions();
    }));

    container.appendChild(card);
  });

  updateSummary();
}

function updateSummary() {
  const total = questions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0);
  $('questions-summary').textContent = `${questions.length} question${questions.length === 1 ? '' : 's'} · ${fmtNum(total)} marks total`;
}

function addQuestion(type) {
  questions.push(blankQuestion(type));
  markDirty();
  renderQuestions();
  const prompts = document.querySelectorAll('.q-prompt');
  prompts[prompts.length - 1]?.focus();
}

function markDirty() { isDirty = true; }

// ------------------------------------------------------------------------------
// Events & saving
// ------------------------------------------------------------------------------

function setupEvents() {
  $('btn-add-q').addEventListener('click', () => addQuestion('single_choice'));
  $('btn-add-q-bottom').addEventListener('click', () => addQuestion('single_choice'));
  $('btn-add-tf').addEventListener('click', () => addQuestion('true_false'));
  $('btn-save-draft').addEventListener('click', () => save('draft'));
  $('btn-save-publish').addEventListener('click', () => save(editingQuiz && editingQuiz.status === 'closed' ? 'closed' : 'published'));

  $('field-course').addEventListener('change', async () => {
    rememberActiveCourse($('field-course').value);
    updateBackLinks();
    if (!editingQuiz) await suggestClassNumber();
    markDirty();
  });

  document.querySelectorAll('#builder input, #builder textarea, #builder select').forEach(el => el.addEventListener('change', markDirty));

  document.querySelectorAll('[data-close-in]').forEach(btn => btn.addEventListener('click', () => {
    const input = $('field-closes-at');
    const v = btn.dataset.closeIn;
    if (v === 'clear') input.value = '';
    else if (v === 'tonight') {
      const d = new Date();
      d.setHours(23, 59, 0, 0);
      input.value = toLocalInput(d);
    } else {
      input.value = toLocalInput(new Date(Date.now() + Number(v) * 60000));
    }
    markDirty();
  }));

  window.addEventListener('beforeunload', (e) => {
    if (isDirty && !isSaving) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

function validate(status) {
  const classNum = parseInt($('field-class-number').value, 10);
  if (!$('field-course').value) return 'Choose a course.';
  if (!classNum || classNum < 1 || classNum > 300) return 'Enter a class number between 1 and 300.';
  if (!$('field-title').value.trim()) return 'Give the quiz a title.';
  if (!$('field-date').value) return 'Choose the class date.';
  const limit = $('field-time-limit').value;
  if (limit && (parseInt(limit, 10) < 1 || parseInt(limit, 10) > 300)) return 'Time limit must be between 1 and 300 minutes.';
  const closesAt = $('field-closes-at').value;
  if (closesAt && status === 'published' && new Date(closesAt) < new Date() && (!editingQuiz || editingQuiz.status === 'draft')) {
    return 'The automatic close time is in the past — students could not take the quiz. Change or clear it.';
  }
  if (isLocked) return null;

  if (questions.length === 0) return 'Add at least one question.';
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.text.trim()) return `Question ${i + 1} is empty.`;
    if (!(Number(q.marks) > 0)) return `Question ${i + 1} needs marks greater than 0.`;
    if (q.options.length < 2) return `Question ${i + 1} needs at least two options.`;
    const empty = q.options.find(o => !o.text.trim());
    if (empty) return `Option ${empty.id} of question ${i + 1} is empty.`;
    if (!q.options.some(o => o.id === q.correct)) return `Pick the correct answer for question ${i + 1}.`;
  }
  return null;
}

async function save(status) {
  const problem = validate(status);
  if (problem) {
    showToast(problem, 'warning');
    return;
  }

  const btn = status === 'draft' ? $('btn-save-draft') : $('btn-save-publish');
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Saving...';
  isSaving = true;

  const quizPayload = {
    id: editingQuiz?.id || null,
    course_id: $('field-course').value,
    class_number: parseInt($('field-class-number').value, 10),
    title: $('field-title').value.trim(),
    description: $('field-description').value.trim(),
    scheduled_date: $('field-date').value,
    status,
    time_limit_minutes: $('field-time-limit').value ? parseInt($('field-time-limit').value, 10) : null,
    closes_at: fromLocalInput($('field-closes-at').value),
    show_score_immediately: $('field-show-score').checked,
    show_correct_answers: $('field-show-answers').checked
  };

  const questionPayload = questions.map(q => ({
    question_text: q.text.trim(),
    question_type: q.type,
    marks: Number(q.marks),
    correct_option: q.correct,
    options: q.options.map(o => ({ id: o.id, text: o.text.trim() }))
  }));

  const { error } = await getSupabase().rpc('save_quiz', { p_quiz: quizPayload, p_questions: questionPayload });

  if (error) {
    isSaving = false;
    btn.disabled = false;
    btn.innerHTML = label;
    const msg = error.code === '23505'
      ? `Class ${quizPayload.class_number} already has a quiz in this course. Use a different class number.`
      : friendlyError(error);
    showToast(msg, 'danger');
    return;
  }

  isDirty = false;
  const verb = status === 'draft' ? 'saved as a draft' : (editingQuiz && editingQuiz.status !== 'draft' ? 'saved' : 'published — students can take it now');
  showToast(`Quiz ${verb}.`, 'success');
  setTimeout(() => { window.location.href = `quizzes.html?course=${quizPayload.course_id}`; }, 700);
}

document.addEventListener('DOMContentLoaded', initBuilder);
