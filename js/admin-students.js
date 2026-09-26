/**
 * ==============================================================================
 * js/admin-students.js - Class roster for a subject, sign-up link, move students
 * ==============================================================================
 * Students are enrolled automatically from their class, so this page shares the
 * sign-up link for the class and moves students between classes (fixing a wrong
 * choice, or promoting the whole class to its next semester).
 */

import { getSupabase, showToast } from './supabase.js';
import {
  guardAdminPage, loadTeacherCourses, pickActiveCourseId, renderCourseSwitcher, noCoursesHtml, loadCourseGradebook
} from './admin-service.js';
import { fetchClasses, createClass, classPickerHtml, bindClassPicker, readClassPicker, NEW_CLASS } from './classes.js';
import {
  escapeHtml, fmtNum, fmtPct, fmtDate, courseLabel, classTitle, classChip, pctBadgeClass, rootUrl, copyText,
  downloadCsv, safeFilename, emptyState, friendlyError, setBusy, showFieldError, clearFieldErrors, ordinal
} from './utils.js';

let courses = [];
let classes = [];
let activeCourse = null;
let book = null;
let moving = [];   // student ids the move dialog applies to

async function initStudentsPage() {
  const teacher = await guardAdminPage();
  if (!teacher) return;

  try {
    [courses, classes] = await Promise.all([loadTeacherCourses(), fetchClasses()]);
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
  document.getElementById('btn-export-roster').addEventListener('click', exportRoster);
  setupMoveModal();

  await selectCourse(pickActiveCourseId(courses));
}

async function selectCourse(courseId) {
  activeCourse = courses.find(c => c.id === courseId);
  document.getElementById('course-title').textContent = courseLabel(activeCourse);
  try {
    book = await loadCourseGradebook(activeCourse);
  } catch (err) {
    showToast('Could not load students: ' + friendlyError(err), 'danger');
    return;
  }
  renderClassCard();
  renderTable();
}

/** Students currently in this subject's class (not ones who moved on but keep their marks here). */
function classStudents() {
  return book.students.filter(s => activeCourse.class_id && s.class_id === activeCourse.class_id);
}

function signupLink() {
  return `${rootUrl('register.html')}?class=${activeCourse.class_id}`;
}

function renderClassCard() {
  const card = document.getElementById('class-card');
  if (!activeCourse.class) {
    card.innerHTML = `
      <div class="alert alert-warning" style="margin: 0;">
        This subject isn't assigned to a class yet, so new students are not added to it.
        Open <a href="index.html">Subjects</a>, edit it and choose its class.
      </div>`;
    return;
  }

  const inClass = classStudents().length;
  card.innerHTML = `
    <div class="class-card-body">
      <div>
        <div class="page-eyebrow">Class</div>
        ${classChip(activeCourse.class, { large: true })}
        <p class="small muted" style="margin: 0.6rem 0 0; max-width: 460px;">
          Students join by choosing this class when they register; the sign-up link selects it for them.
          ${inClass} student${inClass === 1 ? ' is' : 's are'} in this class now.
        </p>
      </div>
      <div class="toolbar">
        <button type="button" id="btn-copy-link" class="btn btn-outline btn-sm">Copy sign-up link</button>
        <button type="button" id="btn-copy-invite" class="btn btn-primary btn-sm">Copy invite message</button>
        <button type="button" id="btn-move-class" class="btn btn-secondary btn-sm" ${inClass ? '' : 'disabled'}>Move class to next semester</button>
      </div>
    </div>`;

  card.querySelector('#btn-copy-link').addEventListener('click', async () => {
    if (await copyText(signupLink())) showToast('Sign-up link copied.', 'success');
  });
  card.querySelector('#btn-copy-invite').addEventListener('click', async () => {
    const title = classTitle(activeCourse.class);
    const msg = `Join Quizora for our daily class quizzes (${title}):\n` +
      `1. Open ${signupLink()} and create a student account.\n` +
      `2. Make sure "${title}" is selected as your class.\n` +
      `Quizzes for all your subjects, including ${activeCourse.name}, will then appear on your dashboard.`;
    if (await copyText(msg)) showToast('Invite message copied — paste it in your class group.', 'success');
  });
  card.querySelector('#btn-move-class').addEventListener('click', () => openMoveModal(classStudents().map(s => s.id), true));
}

function filteredStudents() {
  const term = document.getElementById('student-search-input').value.trim().toLowerCase();
  if (!term) return book.students;
  return book.students.filter(s =>
    [s.full_name, s.student_id, s.email, s.class && classTitle(s.class)].some(v => (v || '').toLowerCase().includes(term)));
}

function renderTable() {
  const tbody = document.getElementById('students-table-body');
  const list = filteredStudents();
  document.getElementById('student-count-pill').textContent =
    `${book.students.length} student${book.students.length === 1 ? '' : 's'}`;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">${book.students.length === 0
      ? emptyState('users', 'No students yet', activeCourse.class
          ? `Students appear here as soon as they register and choose ${classTitle(activeCourse.class)}. Share the sign-up link above.`
          : 'Assign this subject to a class first.')
      : emptyState('search', 'No students match', 'Try a different search.')}</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(s => {
    const sum = book.summaries.get(s.id);
    const inThisClass = activeCourse.class_id && s.class_id === activeCourse.class_id;
    const classCell = s.class
      ? `${escapeHtml(classTitle(s.class))}${inThisClass || !activeCourse.class_id ? '' : '<div class="small muted">Moved · marks kept here</div>'}`
      : '<span class="muted">No class</span>';
    return `
      <tr>
        <td><strong class="text-primary mono">${escapeHtml(s.student_id || '—')}</strong></td>
        <td><strong class="strong">${escapeHtml(s.full_name)}</strong></td>
        <td class="small">${classCell}</td>
        <td class="small">${escapeHtml(s.email)}</td>
        <td class="nowrap">${sum.attempted} / ${sum.counted}</td>
        <td>${sum.counted ? `<span class="badge ${pctBadgeClass(sum.percentage)}">${fmtPct(sum.percentage)}</span>` : '<span class="muted">—</span>'}</td>
        <td class="nowrap">
          <a class="btn btn-secondary btn-sm" href="results.html?course=${activeCourse.id}&student=${s.id}">Report</a>
          <button type="button" class="btn btn-outline btn-sm" data-move="${s.id}">Change class</button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-move]').forEach(btn => btn.addEventListener('click', () => openMoveModal([btn.dataset.move], false)));
}

// ------------------------------------------------------------------------------
// Move students to another class
// ------------------------------------------------------------------------------

function setupMoveModal() {
  const modal = document.getElementById('move-modal');
  modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeMoveModal));
  modal.addEventListener('click', (e) => { if (e.target === modal) closeMoveModal(); });
  document.getElementById('move-form').addEventListener('submit', moveStudents);
}

/** The same program and section, one semester up — the usual promotion target. */
function nextSemesterOf(cls) {
  if (!cls || cls.semester >= 12) return null;
  const norm = (v) => (v || '').trim().toUpperCase();
  const existing = classes.find(c => norm(c.program) === norm(cls.program) && c.semester === cls.semester + 1 && norm(c.section) === norm(cls.section));
  return existing ? { id: existing.id } : { program: cls.program, semester: cls.semester + 1, section: cls.section };
}

function openMoveModal(studentIds, wholeClass) {
  moving = studentIds;
  const form = document.getElementById('move-form');
  clearFieldErrors(form);

  const from = activeCourse.class;
  const one = wholeClass ? null : book.students.find(s => s.id === studentIds[0]);
  document.getElementById('move-modal-title').textContent = wholeClass ? 'Move class to the next semester' : 'Change class';
  document.getElementById('move-summary').textContent = one
    ? `Move ${one.full_name} (${one.student_id || one.email}) from ${one.class ? classTitle(one.class) : 'no class'} to:`
    : `Move ${studentIds.length === 1 ? 'the 1 student' : `all ${studentIds.length} students`} of ${classTitle(from)} to:`;

  const target = wholeClass ? nextSemesterOf(from) : null;
  const currentId = one ? one.class_id : from?.id;
  document.getElementById('move-class-picker').innerHTML = classPickerHtml('move', classes.filter(c => c.id !== currentId), {
    selected: target ? (target.id || NEW_CLASS) : '',
    label: 'New class'
  });
  bindClassPicker(form, 'move');
  if (target && !target.id) {
    document.getElementById('move-program').value = target.program;
    document.getElementById('move-semester').value = String(target.semester);
    document.getElementById('move-section').value = target.section || '';
  }

  document.getElementById('btn-move').textContent = studentIds.length === 1 ? 'Move 1 student' : `Move ${studentIds.length} students`;
  document.getElementById('move-modal').classList.add('active');
  document.getElementById('move-class').focus();
}

function closeMoveModal() {
  document.getElementById('move-modal').classList.remove('active');
  moving = [];
}

async function moveStudents(e) {
  e.preventDefault();
  const form = e.target;
  clearFieldErrors(form);
  const choice = readClassPicker(form, 'move');
  if (choice.error) {
    showFieldError(document.getElementById(choice.field), choice.error);
    return;
  }

  const btn = document.getElementById('btn-move');
  setBusy(btn, true, 'Moving...');
  try {
    const classId = choice.classId || await createClass(choice);
    const { data, error } = await getSupabase().rpc('move_students', { p_student_ids: moving, p_class_id: classId });
    if (error) throw error;
    if (!data?.success) {
      showToast(data?.error || 'Could not move the students.', 'danger');
      return;
    }

    classes = await fetchClasses();
    const target = classes.find(c => c.id === classId);
    const label = target ? classTitle(target) : 'the new class';
    closeMoveModal();
    showToast(data.moved === 1 ? `Moved 1 student to ${label}.` : `Moved ${data.moved} students to ${label}.`, 'success');

    courses = await loadTeacherCourses();
    activeCourse = courses.find(c => c.id === activeCourse.id) || activeCourse;
    await selectCourse(activeCourse.id);
  } catch (err) {
    showToast('Could not move the students: ' + friendlyError(err), 'danger');
  } finally {
    setBusy(btn, false);
  }
}

// ------------------------------------------------------------------------------
// CSV
// ------------------------------------------------------------------------------

function exportRoster() {
  if (!book || book.students.length === 0) {
    showToast('No students to export.', 'warning');
    return;
  }
  const header = ['Roll No', 'Name', 'Class', 'Email', 'Enrolled', 'Quizzes Taken', 'Quizzes Held', 'Marks Earned', 'Marks Possible', 'Percentage'];
  if (activeCourse.final_weight) header.push(`Final Marks (/${fmtNum(activeCourse.final_weight)})`);
  const rows = [header];
  book.students.forEach(s => {
    const sum = book.summaries.get(s.id);
    const row = [s.student_id || '', s.full_name, s.class ? classTitle(s.class) : '', s.email, fmtDate(s.enrolled_at),
      sum.attempted, sum.counted, Number(fmtNum(sum.earned)), Number(fmtNum(sum.possible)), Number(sum.percentage.toFixed(2))];
    if (activeCourse.final_weight) row.push(Number(fmtNum(sum.weighted || 0)));
    rows.push(row);
  });
  const cls = activeCourse.class ? `${activeCourse.class.program}_${ordinal(activeCourse.class.semester)}_` : '';
  downloadCsv(rows, `${safeFilename(cls + (activeCourse.code || activeCourse.name))}_Roster.csv`);
}

document.addEventListener('DOMContentLoaded', initStudentsPage);
