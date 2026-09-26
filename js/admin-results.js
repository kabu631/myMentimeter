/**
 * ==============================================================================
 * js/admin-results.js - Semester Gradebook for one subject
 * ==============================================================================
 * 1. Class matrix: one row per student, one column per quiz, totals, % and
 *    weighted final marks, with per-quiz class averages in the footer
 * 2. Individual view: a student's full record, answer inspection, allow retake
 * 3. CSV exports: whole gradebook (current filter) and a single student report
 * URL: results.html?course=<id>[&student=<id>]
 */

import { getSupabase, showToast } from './supabase.js';
import {
  guardAdminPage, loadTeacherCourses, pickActiveCourseId, renderCourseSwitcher, noCoursesHtml, loadCourseGradebook
} from './admin-service.js';
import { fetchAttemptReview, renderReviewHtml, reviewTitle } from './review.js';
import {
  escapeHtml, fmtNum, fmtPct, fmtDate, fmtDateTime, classLabel, classTitle, courseLabel, percentOf, pctBadgeClass,
  scorePillClass, isQuizClosed, downloadCsv, safeFilename, emptyState, friendlyError, ordinal,
  QUIZ_STATE_BADGES, QUIZ_STATE_LABELS
} from './utils.js';

let courses = [];
let activeCourse = null;
let book = null;          // { students, quizzes, attempts, attemptsByStudent, summaries }
let heldQuizzes = [];     // non-draft quizzes, by class number
let selectedStudentId = null;
const filters = { term: '' };

async function initGradebook() {
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

  renderCourseSwitcher(document.getElementById('course-switcher'), courses, pickActiveCourseId(courses), async (id) => {
    selectedStudentId = null;
    switchView('matrix');
    await selectCourse(id);
  });
  document.getElementById('page-body').classList.remove('hidden');
  setupEvents();

  await selectCourse(pickActiveCourseId(courses));

  const studentParam = new URLSearchParams(window.location.search).get('student');
  if (studentParam && book?.students.some(s => s.id === studentParam)) showStudent(studentParam);
}

async function selectCourse(courseId) {
  activeCourse = courses.find(c => c.id === courseId);
  document.getElementById('course-title').textContent = courseLabel(activeCourse);
  document.getElementById('course-subtitle').textContent = [
    activeCourse.term,
    activeCourse.final_weight ? `Quizzes count for ${fmtNum(activeCourse.final_weight)} marks of the final grade` : 'Tip: set a "quiz marks in final grade" weight on the subject to get scaled final marks'
  ].filter(Boolean).join(' · ');

  try {
    book = await loadCourseGradebook(activeCourse);
  } catch (err) {
    showToast('Could not load the gradebook: ' + friendlyError(err), 'danger');
    return;
  }
  heldQuizzes = book.quizzes.filter(q => q.status !== 'draft');

  const studentSelect = document.getElementById('individual-student-select');
  studentSelect.innerHTML = book.students.map(s =>
    `<option value="${s.id}">${escapeHtml(s.student_id || '—')} · ${escapeHtml(s.full_name)}</option>`).join('');

  renderMetrics();
  renderMatrix();
  if (selectedStudentId) renderIndividual();
}

function setupEvents() {
  document.getElementById('filter-student').addEventListener('input', (e) => { filters.term = e.target.value.trim().toLowerCase(); renderMatrix(); });
  document.getElementById('tab-btn-matrix').addEventListener('click', () => switchView('matrix'));
  document.getElementById('tab-btn-individual').addEventListener('click', () => {
    if (!selectedStudentId && book?.students.length) selectedStudentId = book.students[0].id;
    showStudent(selectedStudentId);
  });
  document.getElementById('btn-back-to-matrix').addEventListener('click', () => switchView('matrix'));
  document.getElementById('individual-student-select').addEventListener('change', (e) => showStudent(e.target.value));
  document.getElementById('btn-export-gradebook').addEventListener('click', exportGradebook);

  const modal = document.getElementById('answer-modal');
  modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => modal.classList.remove('active')));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
}

function switchView(view) {
  const matrix = view === 'matrix';
  document.getElementById('tab-btn-matrix').classList.toggle('active', matrix);
  document.getElementById('tab-btn-individual').classList.toggle('active', !matrix);
  document.getElementById('view-matrix-pane').classList.toggle('hidden', !matrix);
  document.getElementById('view-individual-pane').classList.toggle('hidden', matrix);
}

function showStudent(studentId) {
  if (!studentId) {
    switchView('individual');
    document.getElementById('student-individual-content').innerHTML =
      `<div class="card">${emptyState('users', 'No students yet', 'Students appear here once they register and choose this class.')}</div>`;
    return;
  }
  selectedStudentId = studentId;
  document.getElementById('individual-student-select').value = studentId;
  switchView('individual');
  renderIndividual();
}

function filteredStudents() {
  return book.students.filter(s => {
    if (!filters.term) return true;
    return [s.full_name, s.student_id, s.email].some(v => (v || '').toLowerCase().includes(filters.term));
  });
}

// ------------------------------------------------------------------------------
// Metrics & matrix
// ------------------------------------------------------------------------------

function renderMetrics() {
  const counted = [...book.summaries.values()].filter(s => s.counted > 0);
  const avg = counted.length ? counted.reduce((n, s) => n + s.percentage, 0) / counted.length : null;
  let taken = 0, expected = 0;
  book.summaries.forEach(s => { taken += s.attempted; expected += s.counted; });

  document.getElementById('metric-students').textContent = book.students.length;
  document.getElementById('metric-quizzes').textContent = heldQuizzes.length;
  document.getElementById('metric-avg').textContent = avg === null ? '–' : fmtPct(avg);
  document.getElementById('metric-participation').textContent = expected ? fmtPct(percentOf(taken, expected), 0) : '–';
}

function renderMatrix() {
  const head = document.getElementById('matrix-table-head-row');
  const body = document.getElementById('matrix-table-body');
  const foot = document.getElementById('matrix-table-foot-row');
  const weight = activeCourse.final_weight;
  const totalCols = 2 + heldQuizzes.length + 3 + (weight ? 1 : 0);

  head.innerHTML = `
    <th class="sticky-id">Roll No.</th>
    <th class="sticky-name">Student</th>
    ${heldQuizzes.map(q => `
      <th class="matrix-col-q" title="${escapeHtml(`${classLabel(q.class_number)}: ${q.title} (${fmtDate(q.scheduled_date)}) · ${fmtNum(q.total_marks)} marks`)}">
        C${String(q.class_number).padStart(2, '0')}<div class="small muted" style="font-weight: 500;">/${fmtNum(q.total_marks)}</div>
      </th>`).join('')}
    <th>Earned</th>
    <th>Possible</th>
    <th>%</th>
    ${weight ? `<th>Final /${fmtNum(weight)}</th>` : ''}
  `;

  const list = filteredStudents();
  if (list.length === 0) {
    body.innerHTML = `<tr><td colspan="${totalCols}" style="text-align: left;">${book.students.length === 0
      ? emptyState('users', 'No students yet', activeCourse.class
          ? `Students appear here once they register and choose ${classTitle(activeCourse.class)}.`
          : 'Assign this subject to a class on the Subjects page.')
      : emptyState('search', 'No students match', 'Clear the search.')}</td></tr>`;
    foot.innerHTML = '';
    return;
  }

  const colSum = heldQuizzes.map(() => 0);
  const colCount = heldQuizzes.map(() => 0);

  body.innerHTML = list.map(student => {
    const sum = book.summaries.get(student.id);
    const attempts = book.attemptsByStudent.get(student.id) || new Map();

    const states = new Map(sum.rows.map(r => [r.quiz.id, r.state]));
    const cells = heldQuizzes.map((q, i) => {
      const att = attempts.get(q.id);
      if (att) {
        const sc = Number(att.score);
        const pct = percentOf(sc, Number(att.total_marks));
        colSum[i] += sc;
        colCount[i] += 1;
        return `<td class="matrix-col-q"><span class="score-pill ${scorePillClass(pct)}" title="${fmtNum(sc)} / ${fmtNum(att.total_marks)} (${fmtPct(pct, 0)})">${fmtNum(sc)}</span></td>`;
      }
      const state = states.get(q.id);
      if (state === 'missed') return '<td class="matrix-col-q"><span class="score-pill score-missed" title="Missed">0</span></td>';
      if (state === 'before') return '<td class="matrix-col-q"><span class="score-pill score-none score-before" title="Held before the student joined — not counted">–</span></td>';
      return '<td class="matrix-col-q"><span class="score-pill score-none" title="Open — not taken yet">·</span></td>';
    }).join('');

    return `
      <tr>
        <td class="sticky-id"><button class="link-button mono" data-student="${student.id}">${escapeHtml(student.student_id || '—')}</button></td>
        <td class="sticky-name"><button class="link-button" style="color: var(--text-primary); font-weight: 600; text-align: left;" data-student="${student.id}">${escapeHtml(student.full_name)}</button></td>
        ${cells}
        <td class="strong text-success">${fmtNum(sum.earned)}</td>
        <td class="muted">${fmtNum(sum.possible)}</td>
        <td>${sum.counted ? `<span class="badge ${pctBadgeClass(sum.percentage)}">${fmtPct(sum.percentage)}</span>` : '–'}</td>
        ${weight ? `<td class="strong">${sum.counted ? fmtNum(sum.weighted) : '–'}</td>` : ''}
      </tr>
    `;
  }).join('');

  body.querySelectorAll('[data-student]').forEach(btn => btn.addEventListener('click', () => showStudent(btn.dataset.student)));

  const listSummaries = list.map(s => book.summaries.get(s.id)).filter(s => s.counted > 0);
  const avgPct = listSummaries.length ? listSummaries.reduce((n, s) => n + s.percentage, 0) / listSummaries.length : null;
  const avgWeighted = weight && listSummaries.length ? listSummaries.reduce((n, s) => n + s.weighted, 0) / listSummaries.length : null;

  foot.innerHTML = `
    <th class="sticky-id">Average</th>
    <th class="sticky-name small muted">of students who took it</th>
    ${heldQuizzes.map((q, i) => `<th class="matrix-col-q small">${colCount[i] ? fmtNum(colSum[i] / colCount[i], 1) : '–'}</th>`).join('')}
    <th></th>
    <th></th>
    <th>${avgPct === null ? '–' : fmtPct(avgPct)}</th>
    ${weight ? `<th>${avgWeighted === null ? '–' : fmtNum(avgWeighted)}</th>` : ''}
  `;
}

// ------------------------------------------------------------------------------
// Individual student
// ------------------------------------------------------------------------------

function renderIndividual() {
  const container = document.getElementById('student-individual-content');
  const student = book.students.find(s => s.id === selectedStudentId);
  if (!student) {
    container.innerHTML = '<div class="alert alert-warning">This student is no longer enrolled in this subject.</div>';
    return;
  }
  const sum = book.summaries.get(student.id);
  const weight = activeCourse.final_weight;

  const rows = sum.rows.map(({ quiz, attempt, state }) => {
    const pct = attempt ? percentOf(Number(attempt.score), Number(attempt.total_marks)) : 0;
    const status = QUIZ_STATE_BADGES[state];
    return `
      <tr class="${state === 'missed' ? 'state-missed' : ''}">
        <td class="nowrap">${classLabel(quiz.class_number)}</td>
        <td><strong class="strong">${escapeHtml(quiz.title)}</strong></td>
        <td class="small nowrap">${fmtDate(quiz.scheduled_date)}</td>
        <td>${status}</td>
        <td class="nowrap">${attempt ? `${fmtNum(attempt.score)} / ${fmtNum(attempt.total_marks)}` : state === 'missed' ? `0 / ${fmtNum(quiz.total_marks)}` : '–'}</td>
        <td>${attempt ? `<span class="badge ${pctBadgeClass(pct)}">${fmtPct(pct, 0)}</span>` : '–'}</td>
        <td class="small nowrap">${attempt ? fmtDateTime(attempt.submitted_at) : ''}</td>
        <td class="nowrap no-print">${attempt ? `
          <button class="btn btn-outline btn-sm" data-inspect="${attempt.id}">Answers</button>
          <button class="btn btn-danger-outline btn-sm" data-retake="${attempt.id}" title="Delete this attempt so the student can take the quiz again">Allow retake</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="section-head" style="margin-bottom: 0;">
        <div>
          <div class="page-eyebrow">Semester report</div>
          <h2 style="margin-bottom: 0.25rem;">${escapeHtml(student.full_name)}</h2>
          <div class="small muted">${escapeHtml([student.student_id && `Roll No: ${student.student_id}`, student.class && classTitle(student.class), student.email].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="toolbar no-print">
          <button id="btn-export-student" class="btn btn-secondary btn-sm">Export report (CSV)</button>
          <button id="btn-print-student" class="btn btn-outline btn-sm">Print</button>
        </div>
      </div>
      <div class="report-summary">
        <div><div class="mini-stat-value">${sum.attempted} / ${sum.counted}</div><div class="mini-stat-label">Quizzes taken</div></div>
        <div><div class="mini-stat-value">${fmtNum(sum.earned)} / ${fmtNum(sum.possible)}</div><div class="mini-stat-label">Marks earned</div></div>
        <div><div class="mini-stat-value text-primary">${sum.counted ? fmtPct(sum.percentage) : '–'}</div><div class="mini-stat-label">Semester score</div></div>
        ${weight ? `<div><div class="mini-stat-value text-success">${sum.counted ? fmtNum(sum.weighted) : '–'} / ${fmtNum(weight)}</div><div class="mini-stat-label">Final quiz marks</div></div>` : ''}
      </div>
    </div>

    ${sum.rows.length === 0
      ? `<div class="card">${emptyState('book', 'No quizzes held yet', 'Published quizzes will be listed here.')}</div>`
      : `<div class="table-container">
          <table class="data-table">
            <thead><tr><th>Class</th><th>Quiz</th><th>Date</th><th>Status</th><th>Score</th><th>%</th><th>Submitted</th><th class="no-print"></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`}
  `;

  container.querySelector('#btn-export-student').addEventListener('click', () => exportStudent(student));
  container.querySelector('#btn-print-student').addEventListener('click', () => window.print());
  container.querySelectorAll('[data-inspect]').forEach(btn => btn.addEventListener('click', () => inspectAttempt(btn.dataset.inspect, student)));
  container.querySelectorAll('[data-retake]').forEach(btn => btn.addEventListener('click', () => allowRetake(btn.dataset.retake, student)));
}

async function inspectAttempt(attemptId, student) {
  const modal = document.getElementById('answer-modal');
  const body = document.getElementById('answer-modal-body');
  const badge = document.getElementById('answer-modal-badge');
  document.getElementById('answer-modal-title').textContent = student.full_name;
  badge.textContent = '';
  body.innerHTML = '<p class="muted" style="text-align: center; padding: 2rem;">Loading answers...</p>';
  modal.classList.add('active');

  try {
    const review = await fetchAttemptReview(attemptId);
    document.getElementById('answer-modal-title').textContent = `${student.full_name} — ${reviewTitle(review)}`;
    const pct = percentOf(Number(review.attempt.score), Number(review.attempt.total_marks));
    badge.textContent = `Score: ${fmtNum(review.attempt.score)} / ${fmtNum(review.attempt.total_marks)} (${fmtPct(pct, 0)})`;
    badge.className = `badge ${pctBadgeClass(pct)}`;
    body.innerHTML = renderReviewHtml(review, 'teacher');
  } catch (err) {
    body.innerHTML = `<div class="alert alert-danger">${escapeHtml(friendlyError(err))}</div>`;
  }
}

async function allowRetake(attemptId, student) {
  const attempt = book.attempts.find(a => a.id === attemptId);
  const quiz = book.quizzes.find(q => q.id === attempt?.quiz_id);
  const note = quiz && isQuizClosed(quiz) ? '\n\nThis quiz is closed — reopen it so the student can take it again.' : '';
  if (!confirm(`Delete ${student.full_name}'s attempt at "${quiz?.title}" (score ${fmtNum(attempt?.score)})? They can then take the quiz again. This cannot be undone.${note}`)) return;

  const { error, count } = await getSupabase().from('quiz_attempts').delete({ count: 'exact' }).eq('id', attemptId);
  if (error || count === 0) {
    showToast('Could not reset the attempt' + (error ? `: ${friendlyError(error)}` : '.'), 'danger');
    return;
  }
  showToast(`Attempt deleted — ${student.full_name} can retake the quiz.`, 'success');
  await selectCourse(activeCourse.id);
}

// ------------------------------------------------------------------------------
// CSV
// ------------------------------------------------------------------------------

function exportGradebook() {
  const list = filteredStudents();
  if (list.length === 0) {
    showToast('No students to export.', 'warning');
    return;
  }
  const weight = activeCourse.final_weight;
  const header = ['Roll No', 'Name', 'Class', 'Email',
    ...heldQuizzes.map(q => `${classLabel(q.class_number)} - ${q.title} (/${fmtNum(q.total_marks)})`),
    'Quizzes Taken', 'Quizzes Held', 'Marks Earned', 'Marks Possible', 'Percentage'];
  if (weight) header.push(`Final Marks (/${fmtNum(weight)})`);

  const rows = [header];
  list.forEach(s => {
    const sum = book.summaries.get(s.id);
    const attempts = book.attemptsByStudent.get(s.id) || new Map();
    const states = new Map(sum.rows.map(r => [r.quiz.id, r.state]));
    const row = [s.student_id || '', s.full_name, s.class ? classTitle(s.class) : '', s.email,
      ...heldQuizzes.map(q => {
        const att = attempts.get(q.id);
        if (att) return Number(att.score);
        return states.get(q.id) === 'missed' ? 0 : '';
      }),
      sum.attempted, sum.counted, Number(fmtNum(sum.earned)), Number(fmtNum(sum.possible)), Number(sum.percentage.toFixed(2))];
    if (weight) row.push(Number(fmtNum(sum.weighted || 0)));
    rows.push(row);
  });

  const date = new Date().toISOString().slice(0, 10);
  downloadCsv(rows, `${fileStem()}_Gradebook_${date}.csv`);
  showToast('Gradebook exported.', 'success');
}

function exportStudent(student) {
  const sum = book.summaries.get(student.id);
  const rows = [['Class', 'Quiz', 'Date', 'Status', 'Score', 'Out Of', 'Percentage', 'Submitted']];
  sum.rows.forEach(({ quiz, attempt, state }) => {
    rows.push([
      classLabel(quiz.class_number), quiz.title, quiz.scheduled_date,
      QUIZ_STATE_LABELS[state],
      attempt ? Number(attempt.score) : state === 'missed' ? 0 : '',
      attempt ? Number(attempt.total_marks) : Number(quiz.total_marks),
      attempt ? Number(percentOf(Number(attempt.score), Number(attempt.total_marks)).toFixed(2)) : state === 'missed' ? 0 : '',
      attempt ? fmtDateTime(attempt.submitted_at) : ''
    ]);
  });
  rows.push([]);
  rows.push(['Semester total', '', '', '', Number(fmtNum(sum.earned)), Number(fmtNum(sum.possible)), Number(sum.percentage.toFixed(2)), '']);
  if (activeCourse.final_weight) rows.push([`Final quiz marks (/${fmtNum(activeCourse.final_weight)})`, '', '', '', Number(fmtNum(sum.weighted || 0))]);

  downloadCsv(rows, `${fileStem()}_${safeFilename(student.student_id || student.full_name)}_Report.csv`);
}

/** "BBA_1st_BBA-105" — class plus subject code (or name) for export file names. */
function fileStem() {
  const cls = activeCourse.class ? `${activeCourse.class.program}_${ordinal(activeCourse.class.semester)}_` : '';
  return safeFilename(cls + (activeCourse.code || activeCourse.name));
}

document.addEventListener('DOMContentLoaded', initGradebook);
