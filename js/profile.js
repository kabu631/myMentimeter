/**
 * ==============================================================================
 * js/profile.js - Student Profile & Semester Report Card
 * ==============================================================================
 * Shows, for every subject (grouped by class): each quiz (taken / missed /
 * open), marks earned vs possible, the semester percentage and, if the teacher
 * set a weight, the final quiz marks (e.g. 7.8 / 10). Also lets the student
 * edit their name, class (until they have taken a quiz) and password.
 */

import { getSupabase, showToast } from './supabase.js';
import { requireAuth, renderNavbar, updateUserPassword } from './auth.js';
import { loadStudentData, overallAverage } from './student-data.js';
import { fetchClasses, classOptionsHtml } from './classes.js';
import {
  escapeHtml, fmtNum, fmtPct, fmtDate, classLabel, classTitle, classChip, percentOf, pctBadgeClass,
  isScoreVisible, emptyState, setBusy, friendlyError, showFieldError, clearFieldErrors, QUIZ_STATE_BADGES
} from './utils.js';

let currentUser = null;
let data = null;

async function initProfile() {
  currentUser = await requireAuth('student');
  if (!currentUser) return;

  renderIdentity();
  setupEditing();
  document.getElementById('btn-print').addEventListener('click', () => window.print());
  document.getElementById('report-date').textContent = `As of ${fmtDate(new Date().toISOString())}`;

  await loadReport();
  if (window.location.hash) {
    document.querySelector(window.location.hash)?.scrollIntoView({ behavior: 'smooth' });
  }
}

async function loadReport() {
  try {
    data = await loadStudentData(currentUser);
    renderOverall(data);
    renderReport(data);
  } catch (err) {
    showToast('Could not load your report: ' + friendlyError(err), 'danger');
  }
}

function renderIdentity() {
  document.getElementById('profile-name').textContent = currentUser.full_name || 'My Profile';
  document.getElementById('profile-meta').textContent = [
    currentUser.student_id && `Roll No: ${currentUser.student_id}`,
    currentUser.email
  ].filter(Boolean).join('  ·  ');
  document.getElementById('profile-class').innerHTML = currentUser.class
    ? classChip(currentUser.class, { large: true })
    : '<span class="badge badge-warning">No class chosen yet</span>';
}

function renderOverall({ courses, summaries }) {
  let attempted = 0, counted = 0;
  summaries.forEach(s => { attempted += s.attempted; counted += s.counted; });
  const avg = overallAverage(summaries);
  document.getElementById('overall-courses').textContent = courses.length;
  document.getElementById('overall-taken').textContent = `${attempted} / ${counted}`;
  document.getElementById('overall-average').textContent = avg === null ? '–' : fmtPct(avg);
}

function renderReport({ courses, summaries }) {
  const container = document.getElementById('report-container');
  if (courses.length === 0) {
    container.innerHTML = `<div class="card">${emptyState('book', 'No subjects yet',
      currentUser.class
        ? `Your teachers haven't added subjects to ${classTitle(currentUser.class)} yet.`
        : 'Choose your class on the dashboard to get your subjects.')}</div>`;
    return;
  }

  // Courses arrive ordered current class first; add a heading whenever the class changes
  let lastClass;
  container.innerHTML = courses.map(course => {
    const classKey = course.class_id || 'none';
    let heading = '';
    if (classKey !== lastClass) {
      lastClass = classKey;
      const current = course.class_id === currentUser.class_id;
      heading = `
        <h3 class="report-class-heading">
          ${course.class ? escapeHtml(classTitle(course.class)) : 'Other subjects'}
          ${current && course.class ? '<span class="badge badge-published">Current class</span>' : ''}
        </h3>`;
    }
    return heading + courseReportHtml(course, summaries.get(course.id));
  }).join('');
}

function courseReportHtml(course, s) {
  const rows = s.rows.map(({ quiz, attempt, state }) => {
    let score = '–';
    let pct = '–';
    if (state === 'attempted' && isScoreVisible(quiz)) {
      const p = percentOf(Number(attempt.score), Number(attempt.total_marks));
      score = `${fmtNum(attempt.score)} / ${fmtNum(attempt.total_marks)}`;
      pct = `<span class="badge ${pctBadgeClass(p)}">${fmtPct(p, 0)}</span>`;
    } else if (state === 'attempted') {
      score = '<span class="small muted">After quiz closes</span>';
    } else if (state === 'missed') {
      score = `0 / ${fmtNum(quiz.total_marks)}`;
      pct = '<span class="badge badge-closed">0%</span>';
    } else if (state === 'before') {
      score = '<span class="small muted">Not counted</span>';
    } else {
      score = `<a href="quiz.html?id=${quiz.id}" class="btn btn-primary btn-sm no-print">Take quiz</a>`;
    }
    return `
      <tr class="${state === 'missed' ? 'state-missed' : ''}">
        <td class="nowrap">${classLabel(quiz.class_number)}</td>
        <td>${escapeHtml(quiz.title)}</td>
        <td class="small nowrap">${fmtDate(quiz.scheduled_date)}</td>
        <td>${QUIZ_STATE_BADGES[state]}</td>
        <td class="nowrap">${score}</td>
        <td>${pct}</td>
      </tr>
    `;
  }).join('');

  const hasMarks = s.counted > 0;

  return `
    <div id="course-${course.id}" class="card report-course">
      <div class="section-head" style="margin-bottom: 0;">
        <div>
          <div class="course-card-code">${escapeHtml(course.code || 'Subject')}${course.is_archived ? ' · Archived' : ''}</div>
          <h4 class="course-card-name">${escapeHtml(course.name)}</h4>
          <div class="course-card-meta">${escapeHtml([
            course.teacher?.full_name && `Teacher: ${course.teacher.full_name}`,
            course.term
          ].filter(Boolean).join(' · '))}</div>
        </div>
        <a href="results.html?course=${course.id}" class="btn btn-outline btn-sm no-print">Review answers</a>
      </div>

      <div class="report-summary">
        <div>
          <div class="mini-stat-value">${s.attempted} / ${s.counted}</div>
          <div class="mini-stat-label">Quizzes taken</div>
        </div>
        <div>
          <div class="mini-stat-value">${fmtNum(s.earned)} / ${fmtNum(s.possible)}</div>
          <div class="mini-stat-label">Marks earned</div>
        </div>
        <div>
          <div class="mini-stat-value text-primary">${hasMarks ? fmtPct(s.percentage) : '–'}</div>
          <div class="mini-stat-label">Semester score</div>
        </div>
        ${course.final_weight ? `
        <div>
          <div class="mini-stat-value text-success">${hasMarks ? fmtNum(s.weighted) : '–'} / ${fmtNum(course.final_weight)}</div>
          <div class="mini-stat-label">Final quiz marks</div>
        </div>` : ''}
      </div>

      ${s.rows.length === 0
        ? '<p class="muted" style="margin: 0;">No quizzes have been published in this subject yet.</p>'
        : `<div class="table-container">
            <table class="data-table">
              <thead><tr><th>Class</th><th>Quiz</th><th>Date</th><th>Status</th><th>Score</th><th>%</th></tr></thead>
              <tbody>${rows}</tbody>
              <tfoot>
                <tr>
                  <td colspan="4">Semester total</td>
                  <td class="nowrap">${fmtNum(s.earned)} / ${fmtNum(s.possible)}</td>
                  <td>${hasMarks ? fmtPct(s.percentage) : '–'}</td>
                </tr>
              </tfoot>
            </table>
          </div>`}
    </div>
  `;
}

// ------------------------------------------------------------------------------
// Edit profile
// ------------------------------------------------------------------------------

/** A student picks their own class until they take a quiz; after that a teacher moves them. */
function classLocked() {
  return Boolean(currentUser.class_id) && (data?.attempts.length || 0) > 0;
}

async function fillClassSelect() {
  const select = document.getElementById('edit-class');
  const hint = document.getElementById('edit-class-hint');
  let classes = [];
  try {
    classes = (await fetchClasses()).filter(c => c.subject_count > 0 || c.id === currentUser.class_id);
  } catch (err) {
    select.innerHTML = '<option value="">Classes could not be loaded</option>';
    hint.textContent = friendlyError(err);
    return;
  }
  select.innerHTML = classOptionsHtml(classes, { selected: currentUser.class_id || '', withCounts: true });
  select.disabled = classLocked();
  hint.textContent = classLocked()
    ? "You've already taken quizzes in this class. If it is wrong, ask one of your teachers to move you."
    : 'Changing your class enrolls you in its subjects.';
}

function setupEditing() {
  const panel = document.getElementById('edit-panel');
  document.getElementById('btn-edit-profile').addEventListener('click', () => {
    panel.classList.toggle('hidden');
    if (panel.classList.contains('hidden')) return;
    document.getElementById('edit-name').value = currentUser.full_name || '';
    fillClassSelect();
  });

  document.getElementById('form-profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(e.target);
    const btn = document.getElementById('btn-save-profile');
    const nameInput = document.getElementById('edit-name');
    const classSelect = document.getElementById('edit-class');
    const fullName = nameInput.value.trim();
    if (fullName.length < 2) {
      showFieldError(nameInput, 'Please enter your full name.');
      return;
    }

    const patch = { full_name: fullName };
    const classChanged = !classSelect.disabled && classSelect.value && classSelect.value !== currentUser.class_id;
    if (classChanged) patch.class_id = classSelect.value;

    setBusy(btn, true);
    const { data: updated, error } = await getSupabase()
      .from('profiles')
      .update(patch)
      .eq('id', currentUser.id)
      .select('*, class:classes(id, program, semester, section)')
      .single();
    setBusy(btn, false);

    if (error) {
      showToast(friendlyError(error), 'danger');
      return;
    }
    currentUser = updated;
    renderIdentity();
    renderNavbar(currentUser);
    showToast(classChanged ? `Saved. You're now in ${classTitle(currentUser.class)}.` : 'Profile updated.', 'success');
    if (classChanged) await loadReport();
  });

  document.getElementById('form-password').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-password');
    const pwd = document.getElementById('new-password').value;
    if (pwd !== document.getElementById('confirm-password').value) {
      showToast('The two passwords do not match.', 'warning');
      return;
    }
    setBusy(btn, true, 'Updating...');
    const res = await updateUserPassword(pwd);
    setBusy(btn, false);
    if (!res.success) {
      showToast(res.error, 'danger');
      return;
    }
    e.target.reset();
    showToast('Password updated.', 'success');
  });
}

document.addEventListener('DOMContentLoaded', initProfile);
