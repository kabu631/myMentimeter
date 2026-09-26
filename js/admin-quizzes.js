/**
 * ==============================================================================
 * js/admin-quizzes.js - Quiz list for one course: publish / close / reopen / delete
 * ==============================================================================
 */

import { getSupabase, showToast } from './supabase.js';
import {
  guardAdminPage, loadTeacherCourses, pickActiveCourseId, renderCourseSwitcher, noCoursesHtml,
  updateQuizStatus, deleteQuiz
} from './admin-service.js';
import {
  escapeHtml, fmtNum, fmtDate, fmtDateTime, classLabel, courseLabel, isQuizOpen, isQuizClosed,
  quizStatusBadge, emptyState, friendlyError
} from './utils.js';

let courses = [];
let activeCourse = null;
let quizzes = [];
let filter = 'all';

async function initQuizzesPage() {
  const teacher = await guardAdminPage();
  if (!teacher) return;

  try {
    courses = await loadTeacherCourses();
  } catch (err) {
    showToast(friendlyError(err), 'danger');
    return;
  }

  if (courses.length === 0) {
    document.getElementById('course-switcher').innerHTML = noCoursesHtml();
    return;
  }

  renderCourseSwitcher(document.getElementById('course-switcher'), courses, pickActiveCourseId(courses), selectCourse);
  document.getElementById('page-body').classList.remove('hidden');

  document.getElementById('quizzes-search-input').addEventListener('input', renderTable);
  document.querySelectorAll('[data-filter]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === btn));
    filter = btn.dataset.filter;
    renderTable();
  }));

  const modal = document.getElementById('view-quiz-modal');
  modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => modal.classList.remove('active')));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

  await selectCourse(pickActiveCourseId(courses));
}

async function selectCourse(courseId) {
  activeCourse = courses.find(c => c.id === courseId);
  document.getElementById('course-title').textContent = courseLabel(activeCourse);
  document.getElementById('btn-new-quiz').href = `create-quiz.html?course=${courseId}`;
  await loadQuizzes();
}

async function loadQuizzes() {
  const { data, error } = await getSupabase()
    .from('quizzes')
    .select('*, quiz_attempts(count)')
    .eq('course_id', activeCourse.id)
    .order('class_number', { ascending: true });
  if (error) {
    showToast('Could not load quizzes: ' + friendlyError(error), 'danger');
    return;
  }
  quizzes = (data || []).map(q => ({ ...q, attempt_count: q.quiz_attempts?.[0]?.count || 0 }));
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('quizzes-table-body');
  const term = document.getElementById('quizzes-search-input').value.trim().toLowerCase();

  const list = quizzes.filter(q => {
    const matchesTerm = !term || q.title.toLowerCase().includes(term) || String(q.class_number).includes(term);
    const matchesFilter = filter === 'all' ||
      (filter === 'open' && isQuizOpen(q)) ||
      (filter === 'draft' && q.status === 'draft') ||
      (filter === 'closed' && q.status !== 'draft' && isQuizClosed(q));
    return matchesTerm && matchesFilter;
  });

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">${quizzes.length === 0
      ? emptyState('book', 'No quizzes in this course yet', 'Create your first quiz — it takes a couple of minutes.',
          `<a href="create-quiz.html?course=${activeCourse.id}" class="btn btn-primary">+ New Quiz</a>`)
      : emptyState('search', 'No quizzes match', 'Try a different search or filter.')}</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(q => {
    const actions = [];
    if (q.status === 'draft') actions.push(`<button class="btn btn-success btn-sm" data-action="publish" data-id="${q.id}">Publish</button>`);
    else if (isQuizOpen(q)) actions.push(`<button class="btn btn-outline btn-sm" data-action="close" data-id="${q.id}">Close</button>`);
    else actions.push(`<button class="btn btn-outline btn-sm" data-action="reopen" data-id="${q.id}">Reopen</button>`);
    actions.push(`<button class="btn btn-secondary btn-sm" data-action="view" data-id="${q.id}">View</button>`);
    actions.push(`<a class="btn btn-secondary btn-sm" href="create-quiz.html?id=${q.id}">Edit</a>`);
    if (q.attempt_count === 0) actions.push(`<button class="btn btn-danger-outline btn-sm" data-action="delete" data-id="${q.id}">Delete</button>`);

    return `
      <tr>
        <td><span class="badge badge-primary">${classLabel(q.class_number)}</span></td>
        <td>
          <strong class="strong">${escapeHtml(q.title)}</strong>
          ${q.description ? `<div class="small muted">${escapeHtml(q.description.length > 70 ? q.description.slice(0, 70) + '…' : q.description)}</div>` : ''}
        </td>
        <td class="small nowrap">${fmtDate(q.scheduled_date)}${q.time_limit_minutes ? `<div class="muted">${q.time_limit_minutes} min limit</div>` : ''}</td>
        <td class="nowrap">${q.question_count} · ${fmtNum(q.total_marks)} marks</td>
        <td class="nowrap"><strong>${q.attempt_count}</strong> / ${activeCourse.student_count}</td>
        <td>${quizStatusBadge(q)}${q.closes_at && q.status === 'published' ? `<div class="small muted">${isQuizClosed(q) ? 'Closed' : 'Closes'} ${fmtDateTime(q.closes_at)}</div>` : ''}</td>
        <td><div class="toolbar" style="gap: 0.35rem; flex-wrap: nowrap;">${actions.join('')}</div></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => handleAction(btn.dataset.action, btn.dataset.id)));
}

async function handleAction(action, quizId) {
  const quiz = quizzes.find(q => q.id === quizId);
  if (!quiz) return;

  if (action === 'view') return viewQuiz(quiz);

  let ok = false;
  if (action === 'publish') ok = await updateQuizStatus(quiz, 'published');
  if (action === 'close') {
    if (!confirm(`Close "${quiz.title}"? Students who haven't submitted will score zero for it.`)) return;
    ok = await updateQuizStatus(quiz, 'closed');
  }
  if (action === 'reopen') ok = await updateQuizStatus(quiz, 'published');
  if (action === 'delete') ok = await deleteQuiz(quiz, quiz.attempt_count);
  if (ok) await loadQuizzes();
}

async function viewQuiz(quiz) {
  const modal = document.getElementById('view-quiz-modal');
  const body = document.getElementById('modal-quiz-body');
  document.getElementById('modal-quiz-title').textContent = `${classLabel(quiz.class_number)} · ${quiz.title}`;
  document.getElementById('modal-edit-link').href = `create-quiz.html?id=${quiz.id}`;
  body.innerHTML = '<p class="muted">Loading questions...</p>';
  modal.classList.add('active');

  const { data: questions, error } = await getSupabase()
    .from('questions')
    .select('*')
    .eq('quiz_id', quiz.id)
    .order('order_index', { ascending: true });

  if (error) {
    body.innerHTML = `<div class="alert alert-danger">${escapeHtml(friendlyError(error))}</div>`;
    return;
  }
  if (!questions?.length) {
    body.innerHTML = '<p class="muted">This quiz has no questions yet.</p>';
    return;
  }

  body.innerHTML = questions.map((q, idx) => `
    <div class="card" style="margin-bottom: 1rem; box-shadow: none; background: var(--bg-glass);">
      <div class="review-head">
        <span class="strong">Q${idx + 1}</span>
        <span class="badge badge-primary">${fmtNum(q.marks)} mark${Number(q.marks) === 1 ? '' : 's'}</span>
      </div>
      <div class="review-question">${escapeHtml(q.question_text)}</div>
      <div style="display: grid; gap: 0.35rem; font-size: 0.9rem;">
        ${(q.options || []).map(opt => {
          const correct = opt.id === q.correct_option;
          return `<div style="padding: 0.35rem 0.65rem; border-radius: var(--radius-sm); ${correct ? 'background: var(--success-bg); color: var(--success); font-weight: 700;' : ''}">
            <strong>${escapeHtml(opt.id)}.</strong> ${escapeHtml(opt.text)} ${correct ? '<span class="badge badge-published" style="margin-left: 0.35rem;">Correct</span>' : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
  `).join('');
}

document.addEventListener('DOMContentLoaded', initQuizzesPage);
