/**
 * ==============================================================================
 * js/admin-students.js - Course roster, join code sharing, remove students
 * ==============================================================================
 */

import { getSupabase, showToast } from './supabase.js';
import {
  guardAdminPage, loadTeacherCourses, pickActiveCourseId, renderCourseSwitcher, noCoursesHtml, loadCourseGradebook
} from './admin-service.js';
import {
  escapeHtml, fmtNum, fmtPct, fmtDate, courseLabel, pctBadgeClass, rootUrl, copyText,
  downloadCsv, safeFilename, emptyState, friendlyError
} from './utils.js';

let courses = [];
let activeCourse = null;
let book = null;

async function initStudentsPage() {
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

  document.getElementById('student-search-input').addEventListener('input', renderTable);
  document.getElementById('btn-copy-code').addEventListener('click', async () => {
    if (await copyText(activeCourse.join_code)) showToast('Join code copied.', 'success');
  });
  document.getElementById('btn-copy-invite').addEventListener('click', async () => {
    const msg = `Join ${activeCourse.code} · ${activeCourse.name} for daily class quizzes:\n` +
      `1. Open ${rootUrl('register.html')} and create a student account (or sign in).\n` +
      `2. On your dashboard, enter the course code ${activeCourse.join_code} and press Join Course.`;
    if (await copyText(msg)) showToast('Invite message copied — paste it in your class group.', 'success');
  });
  document.getElementById('btn-export-roster').addEventListener('click', exportRoster);

  await selectCourse(pickActiveCourseId(courses));
}

async function selectCourse(courseId) {
  activeCourse = courses.find(c => c.id === courseId);
  document.getElementById('course-title').textContent = courseLabel(activeCourse);
  document.getElementById('join-code').textContent = activeCourse.join_code;
  try {
    book = await loadCourseGradebook(activeCourse);
  } catch (err) {
    showToast('Could not load students: ' + friendlyError(err), 'danger');
    return;
  }
  renderTable();
}

function filteredStudents() {
  const term = document.getElementById('student-search-input').value.trim().toLowerCase();
  if (!term) return book.students;
  return book.students.filter(s =>
    [s.full_name, s.student_id, s.section, s.email].some(v => (v || '').toLowerCase().includes(term)));
}

function renderTable() {
  const tbody = document.getElementById('students-table-body');
  const list = filteredStudents();
  document.getElementById('student-count-pill').textContent =
    `${book.students.length} student${book.students.length === 1 ? '' : 's'} enrolled`;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">${book.students.length === 0
      ? emptyState('users', 'No students yet', `Share join code ${activeCourse.join_code} with your class.`)
      : emptyState('search', 'No students match', 'Try a different search.')}</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(s => {
    const sum = book.summaries.get(s.id);
    return `
      <tr>
        <td><strong class="text-primary mono">${escapeHtml(s.student_id || '—')}</strong></td>
        <td><strong class="strong">${escapeHtml(s.full_name)}</strong></td>
        <td>${s.section ? `<span class="badge badge-primary">${escapeHtml(s.section)}</span>` : '<span class="muted">—</span>'}</td>
        <td class="small">${escapeHtml(s.email)}</td>
        <td class="small nowrap">${fmtDate(s.enrolled_at)}</td>
        <td class="nowrap">${sum.attempted} / ${sum.counted}</td>
        <td>${sum.counted ? `<span class="badge ${pctBadgeClass(sum.percentage)}">${fmtPct(sum.percentage)}</span>` : '<span class="muted">—</span>'}</td>
        <td class="nowrap">
          <a class="btn btn-secondary btn-sm" href="results.html?course=${activeCourse.id}&student=${s.id}">Report</a>
          <button class="btn btn-danger-outline btn-sm" data-remove="${s.id}">Remove</button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => removeStudent(btn.dataset.remove)));
}

async function removeStudent(studentId) {
  const s = book.students.find(x => x.id === studentId);
  if (!confirm(`Remove ${s.full_name} from ${activeCourse.code}? They will stop seeing this course's quizzes. Their past submissions are kept and return if they re-join.`)) return;

  const { error, count } = await getSupabase()
    .from('enrollments')
    .delete({ count: 'exact' })
    .eq('course_id', activeCourse.id)
    .eq('student_id', studentId);
  if (error || count === 0) {
    showToast('Could not remove the student' + (error ? `: ${friendlyError(error)}` : '.'), 'danger');
    return;
  }
  showToast(`${s.full_name} removed from the course.`, 'info');
  await selectCourse(activeCourse.id);
}

function exportRoster() {
  if (!book || book.students.length === 0) {
    showToast('No students to export.', 'warning');
    return;
  }
  const header = ['Roll No', 'Name', 'Section', 'Email', 'Joined', 'Quizzes Taken', 'Quizzes Held', 'Marks Earned', 'Marks Possible', 'Percentage'];
  if (activeCourse.final_weight) header.push(`Final Marks (/${fmtNum(activeCourse.final_weight)})`);
  const rows = [header];
  book.students.forEach(s => {
    const sum = book.summaries.get(s.id);
    const row = [s.student_id || '', s.full_name, s.section || '', s.email, fmtDate(s.enrolled_at),
      sum.attempted, sum.counted, Number(fmtNum(sum.earned)), Number(fmtNum(sum.possible)), Number(sum.percentage.toFixed(2))];
    if (activeCourse.final_weight) row.push(Number(fmtNum(sum.weighted || 0)));
    rows.push(row);
  });
  downloadCsv(rows, `${safeFilename(activeCourse.code)}_Roster.csv`);
}

document.addEventListener('DOMContentLoaded', initStudentsPage);
