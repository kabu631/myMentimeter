/**
 * ==============================================================================
 * js/admin-home.js - Teacher home: courses, join codes, open quizzes
 * ==============================================================================
 */

import { getSupabase, showToast } from './supabase.js';
import { guardAdminPage, loadTeacherCourses, rememberActiveCourse, updateQuizStatus, fetchAllRows } from './admin-service.js';
import {
  escapeHtml, fmtPct, fmtDateTime, classLabel, percentOf, isQuizOpen,
  copyText, setBusy, friendlyError, emptyState, ICONS
} from './utils.js';

let teacher = null;
let courses = [];
let quizzes = [];
let attempts = [];
let editingCourse = null;

async function initHome() {
  teacher = await guardAdminPage();
  if (!teacher) return;

  document.getElementById('teacher-name').textContent = teacher.full_name || 'Teacher';
  document.getElementById('btn-new-course').addEventListener('click', () => openCourseModal(null));
  document.getElementById('show-archived').addEventListener('change', renderCourses);
  setupCourseModal();

  await loadAll();

  if (new URLSearchParams(window.location.search).get('new') === '1') openCourseModal(null);
}

async function loadAll() {
  const supabase = getSupabase();
  try {
    const [courseList, quizRows, attemptRows] = await Promise.all([
      loadTeacherCourses(),
      fetchAllRows(() => supabase
        .from('quizzes')
        .select('id, course_id, class_number, title, status, closes_at, scheduled_date, total_marks, question_count, quiz_attempts(count)')
        .order('id')),
      fetchAllRows(() => supabase.from('quiz_attempts').select('quiz_id, score, total_marks').order('id'))
    ]);

    courses = courseList;
    quizzes = quizRows;
    attempts = attemptRows;

    renderMetrics();
    renderOpenQuizzes();
    renderCourses();
  } catch (err) {
    console.error(err);
    showToast('Could not load your courses: ' + friendlyError(err), 'danger');
  }
}

function renderMetrics() {
  const active = courses.filter(c => !c.is_archived);
  const activeIds = new Set(active.map(c => c.id));
  document.getElementById('metric-courses').textContent = active.length;
  document.getElementById('metric-students').textContent = active.reduce((n, c) => n + c.student_count, 0);
  document.getElementById('metric-quizzes').textContent = quizzes.filter(q => activeIds.has(q.course_id) && q.status !== 'draft').length;
  document.getElementById('metric-open').textContent = quizzes.filter(isQuizOpen).length;
}

function renderOpenQuizzes() {
  const container = document.getElementById('open-quizzes');
  const courseById = new Map(courses.map(c => [c.id, c]));
  const open = quizzes.filter(isQuizOpen).sort((a, b) => String(b.scheduled_date).localeCompare(String(a.scheduled_date)));

  if (open.length === 0) {
    container.innerHTML = `<div class="card muted small">No quizzes are open. Publish one from the <a href="quizzes.html">Quizzes</a> page after class.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="table-container">
      <table class="data-table">
        <thead><tr><th>Course</th><th>Quiz</th><th>Submissions</th><th>Closes</th><th></th></tr></thead>
        <tbody>
          ${open.map(q => {
            const course = courseById.get(q.course_id);
            const submitted = q.quiz_attempts?.[0]?.count || 0;
            return `
              <tr>
                <td><span class="badge badge-primary">${escapeHtml(course?.code || '')}</span></td>
                <td><strong class="strong">${classLabel(q.class_number)}</strong> · ${escapeHtml(q.title)}</td>
                <td><strong>${submitted}</strong> / ${course?.student_count ?? '–'}</td>
                <td class="small">${q.closes_at ? fmtDateTime(q.closes_at) : 'When you close it'}</td>
                <td class="nowrap">
                  <button class="btn btn-outline btn-sm" data-close-quiz="${q.id}">Close now</button>
                  <a class="btn btn-secondary btn-sm" href="results.html?course=${q.course_id}">Results</a>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll('[data-close-quiz]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const quiz = quizzes.find(q => q.id === btn.dataset.closeQuiz);
      if (!confirm(`Close "${quiz.title}"? Students who haven't submitted will score zero for it.`)) return;
      if (await updateQuizStatus(quiz, 'closed')) await loadAll();
    });
  });
}

function renderCourses() {
  const grid = document.getElementById('courses-grid');
  const showArchived = document.getElementById('show-archived').checked;
  const list = courses.filter(c => showArchived || !c.is_archived);
  document.getElementById('how-it-works').classList.toggle('hidden', courses.length > 2);

  if (courses.length === 0) {
    grid.innerHTML = `<div class="card" style="grid-column: 1 / -1;">${emptyState('book', 'Create your first course',
      'Each course gets a join code for students. You can create one per subject or per section.',
      '<button class="btn btn-primary" data-new-course>+ New Course</button>')}</div>`;
    grid.querySelector('[data-new-course]').addEventListener('click', () => openCourseModal(null));
    return;
  }
  if (list.length === 0) {
    grid.innerHTML = '<div class="card muted" style="grid-column: 1 / -1;">All your courses are archived. Tick "Show archived" to see them.</div>';
    return;
  }

  grid.innerHTML = list.map(course => {
    const cq = quizzes.filter(q => q.course_id === course.id);
    const held = cq.filter(q => q.status !== 'draft').length;
    const drafts = cq.filter(q => q.status === 'draft').length;
    const openNow = cq.filter(isQuizOpen).length;
    const quizIds = new Set(cq.map(q => q.id));
    let earned = 0, possible = 0;
    attempts.forEach(a => { if (quizIds.has(a.quiz_id)) { earned += Number(a.score); possible += Number(a.total_marks); } });
    const avg = possible > 0 ? fmtPct(percentOf(earned, possible), 0) : '–';
    const otherTeacher = course.teacher_id !== teacher.id ? ` · ${escapeHtml(course.teacher?.full_name || 'another teacher')}` : '';

    return `
      <div class="card course-card ${course.is_archived ? 'is-archived' : ''}">
        <div style="display: flex; justify-content: space-between; gap: 0.75rem; align-items: flex-start;">
          <div>
            <div class="course-card-code">${escapeHtml(course.code)}${course.section ? ` · Section ${escapeHtml(course.section)}` : ''}${course.is_archived ? ' · Archived' : ''}</div>
            <h3 class="course-card-name">${escapeHtml(course.name)}</h3>
            <div class="course-card-meta">${escapeHtml(course.term || '')}${otherTeacher}</div>
          </div>
          <button class="icon-btn" title="Edit course" data-edit="${course.id}" aria-label="Edit course">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
        </div>

        <div class="toolbar" style="gap: 0.5rem;">
          <span class="small muted">Join code</span>
          <span class="join-code">${escapeHtml(course.join_code)}
            <button class="icon-btn" title="Copy join code" data-copy="${escapeHtml(course.join_code)}" aria-label="Copy join code">${ICONS.copy}</button>
          </span>
          ${openNow ? `<span class="badge badge-published">${openNow} open</span>` : ''}
        </div>

        <div class="mini-stats">
          <div><div class="mini-stat-value">${course.student_count}</div><div class="mini-stat-label">Students</div></div>
          <div><div class="mini-stat-value">${held}${drafts ? `<span class="small muted"> +${drafts}</span>` : ''}</div><div class="mini-stat-label">Quizzes${drafts ? ' (+drafts)' : ''}</div></div>
          <div><div class="mini-stat-value">${avg}</div><div class="mini-stat-label">Avg score</div></div>
        </div>

        <div class="card-actions">
          <a href="create-quiz.html?course=${course.id}" class="btn btn-primary btn-sm" data-go="${course.id}">+ Quiz</a>
          <a href="quizzes.html?course=${course.id}" class="btn btn-secondary btn-sm" data-go="${course.id}">Quizzes</a>
          <a href="students.html?course=${course.id}" class="btn btn-secondary btn-sm" data-go="${course.id}">Students</a>
          <a href="results.html?course=${course.id}" class="btn btn-secondary btn-sm" data-go="${course.id}">Gradebook</a>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('[data-edit]').forEach(btn =>
    btn.addEventListener('click', () => openCourseModal(courses.find(c => c.id === btn.dataset.edit))));
  grid.querySelectorAll('[data-copy]').forEach(btn =>
    btn.addEventListener('click', async () => {
      if (await copyText(btn.dataset.copy)) showToast(`Join code ${btn.dataset.copy} copied.`, 'success');
    }));
  grid.querySelectorAll('[data-go]').forEach(link =>
    link.addEventListener('click', () => rememberActiveCourse(link.dataset.go)));
}

// ------------------------------------------------------------------------------
// Course modal
// ------------------------------------------------------------------------------

function setupCourseModal() {
  const modal = document.getElementById('course-modal');
  modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeCourseModal));
  modal.addEventListener('click', (e) => { if (e.target === modal) closeCourseModal(); });
  document.getElementById('course-form').addEventListener('submit', saveCourse);
  document.getElementById('btn-regenerate-code').addEventListener('click', regenerateCode);
  document.getElementById('btn-delete-course').addEventListener('click', deleteCourse);
}

function openCourseModal(course) {
  editingCourse = course;
  document.getElementById('course-modal-title').textContent = course ? 'Edit Course' : 'New Course';
  document.getElementById('course-code').value = course?.code || '';
  document.getElementById('course-name').value = course?.name || '';
  document.getElementById('course-section').value = course?.section || '';
  document.getElementById('course-term').value = course?.term || '';
  document.getElementById('course-classes').value = course?.planned_classes || 35;
  document.getElementById('course-weight').value = course?.final_weight ?? '';
  document.getElementById('course-archived').checked = Boolean(course?.is_archived);
  document.getElementById('course-join-code').textContent = course?.join_code || '';
  document.getElementById('course-edit-extras').classList.toggle('hidden', !course);
  document.getElementById('btn-delete-course').classList.toggle('hidden', !course);
  document.getElementById('course-modal').classList.add('active');
  document.getElementById('course-code').focus();
}

function closeCourseModal() {
  document.getElementById('course-modal').classList.remove('active');
  editingCourse = null;
}

async function saveCourse(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save-course');
  const weight = document.getElementById('course-weight').value;
  const payload = {
    code: document.getElementById('course-code').value.trim(),
    name: document.getElementById('course-name').value.trim(),
    section: document.getElementById('course-section').value.trim() || null,
    term: document.getElementById('course-term').value.trim() || null,
    planned_classes: parseInt(document.getElementById('course-classes').value, 10) || 35,
    final_weight: weight ? Number(weight) : null,
    updated_at: new Date().toISOString()
  };

  if (!payload.code || !payload.name) {
    showToast('Course code and name are required.', 'warning');
    return;
  }

  setBusy(btn, true);
  const supabase = getSupabase();
  let result;
  if (editingCourse) {
    payload.is_archived = document.getElementById('course-archived').checked;
    result = await supabase.from('courses').update(payload).eq('id', editingCourse.id).select().single();
  } else {
    payload.teacher_id = teacher.id;
    result = await supabase.from('courses').insert(payload).select().single();
  }
  setBusy(btn, false);

  if (result.error) {
    showToast('Could not save the course: ' + friendlyError(result.error), 'danger');
    return;
  }

  const created = !editingCourse;
  closeCourseModal();
  if (created) {
    rememberActiveCourse(result.data.id);
    showToast(`Course created! Share join code ${result.data.join_code} with your students.`, 'success');
  } else {
    showToast('Course saved.', 'success');
  }
  await loadAll();
}

function newJoinCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

async function regenerateCode() {
  if (!editingCourse) return;
  if (!confirm('Generate a new join code? The current code will stop working for new students.')) return;
  const code = newJoinCode();
  const { data, error } = await getSupabase().from('courses').update({ join_code: code }).eq('id', editingCourse.id).select().single();
  if (error) {
    showToast('Could not change the code: ' + friendlyError(error), 'danger');
    return;
  }
  editingCourse = data;
  document.getElementById('course-join-code').textContent = data.join_code;
  showToast(`New join code: ${data.join_code}`, 'success');
  await loadAll();
}

async function deleteCourse() {
  if (!editingCourse) return;
  const hasSubmissions = quizzes.some(q => q.course_id === editingCourse.id && (q.quiz_attempts?.[0]?.count || 0) > 0);
  if (hasSubmissions) {
    alert('Students have already submitted quizzes in this course, so it cannot be deleted. Archive it instead to keep their marks.');
    return;
  }
  if (!confirm(`Delete ${editingCourse.code} · ${editingCourse.name}, its quizzes and enrollments? This cannot be undone.`)) return;

  const { error, count } = await getSupabase().from('courses').delete({ count: 'exact' }).eq('id', editingCourse.id);
  if (error || count === 0) {
    showToast('Could not delete the course' + (error ? `: ${friendlyError(error)}` : '.'), 'danger');
    return;
  }
  closeCourseModal();
  showToast('Course deleted.', 'info');
  await loadAll();
}

document.addEventListener('DOMContentLoaded', initHome);
