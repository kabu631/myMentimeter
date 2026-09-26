/**
 * ==============================================================================
 * js/dashboard.js - Student Dashboard Controller
 * ==============================================================================
 * 1. Identity header and headline stats
 * 2. Open quizzes across every enrolled course (start, or see submitted score)
 * 3. Course cards with running semester marks, plus "join course by code"
 * 4. Five most recent results
 */

import { getSupabase, showToast } from './supabase.js';
import { requireAuth } from './auth.js';
import { loadStudentData, overallAverage } from './student-data.js';
import {
  escapeHtml, fmtNum, fmtPct, fmtDate, fmtDateTime, classLabel, percentOf, pctBadgeClass,
  isQuizOpen, isScoreVisible, emptyState, setBusy, friendlyError, ICONS
} from './utils.js';

let currentUser = null;

async function initStudentDashboard() {
  currentUser = await requireAuth('student');
  if (!currentUser) return;

  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = ICONS[el.dataset.icon]; });
  document.getElementById('student-name').textContent = currentUser.full_name || 'Student';
  document.getElementById('student-meta').textContent = [
    currentUser.student_id && `Roll No: ${currentUser.student_id}`,
    currentUser.section && `Section: ${currentUser.section}`,
    currentUser.email
  ].filter(Boolean).join('  ·  ');

  document.getElementById('join-form').addEventListener('submit', handleJoin);

  await loadDashboard();
}

async function loadDashboard() {
  try {
    const data = await loadStudentData(currentUser.id);
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

  document.getElementById('stat-courses').textContent = courses.filter(c => !c.is_archived).length;
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
      'When your teacher publishes a quiz after class, it will show up here.')}</div>`;
    return;
  }

  container.innerHTML = open.map(quiz => {
    const course = courseById.get(quiz.course_id);
    const attempt = attemptByQuiz.get(quiz.id);
    const meta = [
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
            <span class="badge badge-primary">${escapeHtml(course?.code || '')}</span>
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

  if (courses.length === 0) {
    grid.innerHTML = `<div class="card" style="grid-column: 1 / -1;">${emptyState('key', 'Join your first course',
      'Ask your teacher for the course code, type it in the box above and press "Join Course".')}</div>`;
    return;
  }

  grid.innerHTML = courses.map(course => {
    const s = summaries.get(course.id);
    const hasMarks = s.counted > 0;
    const weighted = s.weighted !== null && hasMarks
      ? `${fmtNum(s.weighted)} / ${fmtNum(course.final_weight)}`
      : null;

    return `
      <div class="card course-card ${course.is_archived ? 'is-archived' : ''}">
        <div>
          <div class="course-card-code">${escapeHtml(course.code)}${course.is_archived ? ' · Archived' : ''}</div>
          <h3 class="course-card-name">${escapeHtml(course.name)}</h3>
          <div class="course-card-meta">
            ${escapeHtml([course.teacher?.full_name, course.section && `Section ${course.section}`, course.term].filter(Boolean).join(' · '))}
          </div>
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
        <td><span class="badge badge-primary">${escapeHtml(course?.code || '')}</span></td>
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

async function handleJoin(e) {
  e.preventDefault();
  const input = document.getElementById('join-code');
  const btn = document.getElementById('btn-join');
  const code = input.value.trim();
  if (!code) {
    input.focus();
    showToast('Enter the course code your teacher gave you.', 'warning');
    return;
  }

  setBusy(btn, true, 'Joining...');
  try {
    const { data, error } = await getSupabase().rpc('join_course', { p_code: code });
    if (error) throw error;
    if (!data?.success) {
      showToast(data?.error || 'Could not join that course.', 'danger');
      return;
    }
    input.value = '';
    showToast(data.already_enrolled
      ? `You're already in ${data.course_code}.`
      : `Joined ${data.course_code} · ${data.course_name}!`, 'success');
    await loadDashboard();
  } catch (err) {
    showToast(friendlyError(err), 'danger');
  } finally {
    setBusy(btn, false);
  }
}

document.addEventListener('DOMContentLoaded', initStudentDashboard);
