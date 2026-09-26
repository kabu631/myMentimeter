/**
 * ==============================================================================
 * js/profile.js - Student Profile & Semester Report Card
 * ==============================================================================
 * Shows, for every enrolled course: each quiz (taken / missed / open), marks
 * earned vs possible, the semester percentage and, if the teacher set a weight,
 * the final quiz marks (e.g. 7.8 / 10). Also lets the student edit their name,
 * section and password.
 */

import { getSupabase, showToast } from './supabase.js';
import { requireAuth, renderNavbar, updateUserPassword } from './auth.js';
import { loadStudentData, overallAverage } from './student-data.js';
import {
  escapeHtml, fmtNum, fmtPct, fmtDate, classLabel, percentOf, pctBadgeClass,
  isScoreVisible, emptyState, setBusy, friendlyError
} from './utils.js';

let currentUser = null;

async function initProfile() {
  currentUser = await requireAuth('student');
  if (!currentUser) return;

  renderIdentity();
  setupEditing();
  document.getElementById('btn-print').addEventListener('click', () => window.print());
  document.getElementById('report-date').textContent = `As of ${fmtDate(new Date().toISOString())}`;

  try {
    const data = await loadStudentData(currentUser.id);
    renderOverall(data);
    renderReport(data);
    if (window.location.hash) {
      document.querySelector(window.location.hash)?.scrollIntoView({ behavior: 'smooth' });
    }
  } catch (err) {
    showToast('Could not load your report: ' + friendlyError(err), 'danger');
  }
}

function renderIdentity() {
  document.getElementById('profile-name').textContent = currentUser.full_name || 'My Profile';
  document.getElementById('profile-meta').textContent = [
    currentUser.student_id && `Roll No: ${currentUser.student_id}`,
    currentUser.section && `Section: ${currentUser.section}`,
    currentUser.email
  ].filter(Boolean).join('  ·  ');
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
    container.innerHTML = `<div class="card">${emptyState('key', 'No courses yet',
      'Join a course from your dashboard using the code your teacher gives you.')}</div>`;
    return;
  }

  container.innerHTML = courses.map(course => {
    const s = summaries.get(course.id);
    const stateBadge = {
      attempted: '<span class="badge badge-published">Taken</span>',
      missed: '<span class="badge badge-closed">Missed</span>',
      pending: '<span class="badge badge-warning">Open</span>'
    };

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
      } else {
        score = `<a href="quiz.html?id=${quiz.id}" class="btn btn-primary btn-sm no-print">Take quiz</a>`;
      }
      return `
        <tr class="${state === 'missed' ? 'state-missed' : ''}">
          <td class="nowrap">${classLabel(quiz.class_number)}</td>
          <td>${escapeHtml(quiz.title)}</td>
          <td class="small nowrap">${fmtDate(quiz.scheduled_date)}</td>
          <td>${stateBadge[state]}</td>
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
            <div class="course-card-code">${escapeHtml(course.code)}${course.is_archived ? ' · Archived' : ''}</div>
            <h3 class="course-card-name">${escapeHtml(course.name)}</h3>
            <div class="course-card-meta">${escapeHtml([
              course.teacher?.full_name && `Teacher: ${course.teacher.full_name}`,
              course.section && `Section ${course.section}`,
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
          ? '<p class="muted" style="margin: 0;">No quizzes have been published in this course yet.</p>'
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
  }).join('');
}

function setupEditing() {
  const panel = document.getElementById('edit-panel');
  document.getElementById('btn-edit-profile').addEventListener('click', () => {
    panel.classList.toggle('hidden');
    document.getElementById('edit-name').value = currentUser.full_name || '';
    document.getElementById('edit-section').value = currentUser.section || '';
  });

  document.getElementById('form-profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-profile');
    const fullName = document.getElementById('edit-name').value.trim();
    const section = document.getElementById('edit-section').value.trim();
    if (fullName.length < 2) {
      showToast('Please enter your full name.', 'warning');
      return;
    }

    setBusy(btn, true);
    const { data, error } = await getSupabase()
      .from('profiles')
      .update({ full_name: fullName, section: section || null })
      .eq('id', currentUser.id)
      .select()
      .single();
    setBusy(btn, false);

    if (error) {
      showToast(friendlyError(error), 'danger');
      return;
    }
    currentUser = data;
    renderIdentity();
    renderNavbar(currentUser);
    showToast('Profile updated.', 'success');
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
