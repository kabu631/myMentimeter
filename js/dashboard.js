/**
 * ==============================================================================
 * js/dashboard.js - Student Dashboard Controller
 * ==============================================================================
 * 1. Identity header (roll number, class) and headline stats
 * 2. Open quizzes across every subject of the student's class
 * 3. Subject cards with running semester marks (or a class picker if the
 *    student has no class yet)
 * 4. Five most recent results
 */

import { getSupabase, showToast } from './supabase.js';
import { requireAuth, renderNavbar } from './auth.js';
import { loadStudentData, overallAverage } from './student-data.js';
import { fetchClasses, classOptionsHtml } from './classes.js';
import {
  escapeHtml, fmtNum, fmtPct, fmtDate, fmtDateTime, classLabel, classTitle, classChip, courseTag,
  percentOf, pctBadgeClass, isQuizOpen, isScoreVisible, emptyState, setBusy, friendlyError, ICONS
} from './utils.js';

let currentUser = null;

async function initStudentDashboard() {
  currentUser = await requireAuth('student');
  if (!currentUser) return;

  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = ICONS[el.dataset.icon]; });
  renderIdentity();
  await loadDashboard();
}

function renderIdentity() {
  document.getElementById('student-name').textContent = currentUser.full_name || 'Student';
  document.getElementById('student-meta').textContent = [
    currentUser.student_id && `Roll No: ${currentUser.student_id}`,
    currentUser.email
  ].filter(Boolean).join('  ·  ');
  document.getElementById('student-class').innerHTML = currentUser.class
    ? classChip(currentUser.class, { large: true })
    : '<span class="badge badge-warning">No class chosen yet</span>';
}

async function loadDashboard() {
  try {
    const data = await loadStudentData(currentUser);
    renderStats(data);
    renderOpenQuizzes(data);
    renderCourses(data);
    renderRecentResults(data);
  } catch (err) {
    console.error('Error loading dashboard:', err);
    showToast('Could not load your dashboard: ' + friendlyError(err), 'danger');
  }
}

function renderStats({ courses, summaries }) {
  let attempted = 0;
  let counted = 0;
  summaries.forEach(s => { attempted += s.attempted; counted += s.counted; });
  const avg = overallAverage(summaries);

  document.getElementById('stat-courses').textContent = courses.filter(c => c.is_current).length;
  document.getElementById('stat-taken').textContent = `${attempted} / ${counted}`;
  document.getElementById('stat-average').textContent = avg === null ? '–' : fmtPct(avg);
}

function renderOpenQuizzes({ quizzes, courseById, attemptByQuiz }) {
  const container = document.getElementById('open-quizzes');
  const open = quizzes
    .filter(isQuizOpen)
    .sort((a, b) => Number(attemptByQuiz.has(a.id)) - Number(attemptByQuiz.has(b.id)) ||
                    String(b.scheduled_date).localeCompare(String(a.scheduled_date)));

  if (open.length === 0) {
    container.innerHTML = `<div class="card">${emptyState('clock', 'No open quizzes right now',
      'When one of your teachers publishes a quiz after class, it will show up here.')}</div>`;
    return;
  }

  container.innerHTML = open.map(quiz => {
    const course = courseById.get(quiz.course_id);
    const attempt = attemptByQuiz.get(quiz.id);
    const meta = [
      course?.teacher?.full_name,
      `${quiz.question_count} question${quiz.question_count === 1 ? '' : 's'}`,
      `${fmtNum(quiz.total_marks)} marks`,
      quiz.time_limit_minutes ? `${quiz.time_limit_minutes} min limit` : 'Untimed',
      quiz.closes_at ? `Closes ${fmtDateTime(quiz.closes_at)}` : null
    ].filter(Boolean);

    let action;
    if (!attempt) {
      action = `<a href="quiz.html?id=${quiz.id}" class="btn btn-primary">Start Quiz &rarr;</a>`;
    } else if (isScoreVisible(quiz)) {
      const pct = percentOf(Number(attempt.score), Number(attempt.total_marks));
      action = `
        <div style="text-align: right;">
          <div class="small muted">Your score</div>
          <div class="stat-value text-success">${fmtNum(attempt.score)} <span class="small muted">/ ${fmtNum(attempt.total_marks)}</span></div>
          <span class="badge ${pctBadgeClass(pct)}">${fmtPct(pct, 0)}</span>
        </div>`;
    } else {
      action = `<span class="badge badge-published">Submitted · score after the quiz closes</span>`;
    }

    return `
      <div class="card quiz-tile ${attempt ? 'is-done' : ''}">
        <div style="flex: 1; min-width: 240px;">
          <div class="toolbar" style="gap: 0.5rem;">
            <span class="badge badge-primary">${escapeHtml(courseTag(course))}</span>
            <span class="badge ${attempt ? 'badge-published' : 'badge-warning'}">${attempt ? 'Completed' : 'Available now'}</span>
            <span class="small muted">${classLabel(quiz.class_number)} · ${fmtDate(quiz.scheduled_date)}</span>
          </div>
          <h3 class="quiz-tile-title">${escapeHtml(quiz.title)}</h3>
          ${quiz.description ? `<p class="small" style="margin: 0.25rem 0 0;">${escapeHtml(quiz.description)}</p>` : ''}
          <div class="quiz-tile-meta">${meta.map(m => `<span>${escapeHtml(m)}</span>`).join('')}</div>
        </div>
        <div>${action}</div>
      </div>
    `;
  }).join('');
}

function renderCourses({ courses, summaries }) {
  const grid = document.getElementById('courses-grid');
  renderClassPicker();

  if (courses.length === 0) {
    grid.innerHTML = currentUser.class
      ? `<div class="card" style="grid-column: 1 / -1;">${emptyState('book', 'No subjects yet',
          `Your teachers haven't added subjects to ${classTitle(currentUser.class)} yet. They will appear here automatically.`)}</div>`
      : '';
    return;
  }

  grid.innerHTML = courses.map(course => {
    const s = summaries.get(course.id);
    const hasMarks = s.counted > 0;
    const weighted = s.weighted !== null && hasMarks
      ? `${fmtNum(s.weighted)} / ${fmtNum(course.final_weight)}`
      : null;
    const flag = course.is_archived ? ' · Archived' : !course.is_current ? ' · Earlier class' : '';
    const meta = [
      course.teacher?.full_name,
      !course.is_current && course.class ? classTitle(course.class) : null,
      course.term
    ].filter(Boolean).join(' · ');

    return `
      <div class="card course-card ${course.is_current ? '' : 'is-archived'}">
        <div>
          <div class="course-card-code">${escapeHtml(course.code || 'Subject')}${flag}</div>
          <h3 class="course-card-name">${escapeHtml(course.name)}</h3>
          <div class="course-card-meta">${escapeHtml(meta)}</div>
        </div>
        <div class="mini-stats">
          <div>
            <div class="mini-stat-value">${s.attempted}/${s.counted}</div>
            <div class="mini-stat-label">Taken</div>
          </div>
          <div>
            <div class="mini-stat-value">${hasMarks ? fmtPct(s.percentage, 0) : '–'}</div>
            <div class="mini-stat-label">Score</div>
          </div>
          <div>
            <div class="mini-stat-value">${weighted || `${fmtNum(s.earned)}/${fmtNum(s.possible)}`}</div>
            <div class="mini-stat-label">${weighted ? 'Final marks' : 'Marks'}</div>
          </div>
        </div>
        ${courseProgress(s)}
        <div class="card-actions">
          <a href="profile.html#course-${course.id}" class="btn btn-secondary btn-sm">Semester report</a>
          <a href="results.html?course=${course.id}" class="btn btn-outline btn-sm">Quiz results</a>
        </div>
      </div>
    `;
  }).join('');
}

/** "Quizzes taken" progress bar; turns green when the student has taken every held quiz. */
function courseProgress(s) {
  if (s.counted === 0) return '';
  const pct = Math.round((s.attempted / s.counted) * 100);
  return `
    <div class="course-progress">
      <div class="course-progress-label"><span>Participation</span><span>${pct}%</span></div>
      <div class="progress-container" role="progressbar" aria-label="Quizzes taken" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-fill ${pct === 100 ? 'is-complete' : ''}" style="width: ${pct}%;"></div>
      </div>
    </div>`;
}

/** Students without a class (e.g. accounts from before classes existed) choose one here. */
async function renderClassPicker() {
  const box = document.getElementById('choose-class');
  box.classList.toggle('hidden', Boolean(currentUser.class_id));
  if (currentUser.class_id) return;

  box.innerHTML = '<div class="card muted">Loading classes...</div>';
  let classes = [];
  try {
    classes = (await fetchClasses()).filter(c => c.subject_count > 0);
  } catch (err) {
    box.innerHTML = `<div class="alert alert-danger">${escapeHtml(friendlyError(err))}</div>`;
    return;
  }

  box.innerHTML = `
    <div class="card section-block">
      ${emptyState('users', 'Choose your class',
        classes.length
          ? 'Pick the class you study in. You will be enrolled in all of its subjects automatically.'
          : 'No classes are open yet. Your teachers create them when they register — check back soon.')}
      ${classes.length ? `
        <form id="choose-class-form" class="toolbar" style="justify-content: center;">
          <label for="choose-class-select" class="sr-only">Your class</label>
          <select id="choose-class-select" class="form-select" style="max-width: 360px;">
            ${classOptionsHtml(classes, { withCounts: true })}
          </select>
          <button type="submit" id="btn-choose-class" class="btn btn-primary">Save my class</button>
        </form>` : ''}
    </div>`;

  document.getElementById('choose-class-form')?.addEventListener('submit', saveClass);
}

async function saveClass(e) {
  e.preventDefault();
  const select = document.getElementById('choose-class-select');
  const btn = document.getElementById('btn-choose-class');
  if (!select.value) {
    select.focus();
    showToast('Choose your class first.', 'warning');
    return;
  }

  setBusy(btn, true);
  const { data, error } = await getSupabase()
    .from('profiles')
    .update({ class_id: select.value })
    .eq('id', currentUser.id)
    .select('*, class:classes(id, program, semester, section)')
    .single();
  setBusy(btn, false);

  if (error) {
    showToast(friendlyError(error), 'danger');
    return;
  }
  currentUser = data;
  renderIdentity();
  renderNavbar(currentUser);
  showToast(`You're in ${classTitle(currentUser.class)}. Your subjects are ready.`, 'success');
  await loadDashboard();
}

function renderRecentResults({ attempts, quizById, courseById }) {
  const tbody = document.getElementById('recent-results-body');
  const recent = attempts.filter(a => quizById.has(a.quiz_id)).slice(0, 5);

  if (recent.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">${emptyState('book', 'No quizzes taken yet', 'Your scores will appear here after you submit a quiz.')}</td></tr>`;
    return;
  }

  tbody.innerHTML = recent.map(att => {
    const quiz = quizById.get(att.quiz_id);
    const course = courseById.get(quiz.course_id);
    const visible = isScoreVisible(quiz);
    const pct = percentOf(Number(att.score), Number(att.total_marks));
    return `
      <tr>
        <td><span class="badge badge-primary">${escapeHtml(courseTag(course))}</span></td>
        <td><strong>${classLabel(quiz.class_number)}</strong> · ${escapeHtml(quiz.title)}</td>
        <td class="small nowrap hide-sm">${fmtDateTime(att.submitted_at)}</td>
        <td class="nowrap">${visible
          ? `<strong class="strong">${fmtNum(att.score)} / ${fmtNum(att.total_marks)}</strong> <span class="badge ${pctBadgeClass(pct)}">${fmtPct(pct, 0)}</span>`
          : '<span class="small muted">After quiz closes</span>'}</td>
        <td><a href="results.html?attempt=${att.id}" class="btn btn-outline btn-sm">Review</a></td>
      </tr>
    `;
  }).join('');
}

document.addEventListener('DOMContentLoaded', initStudentDashboard);
