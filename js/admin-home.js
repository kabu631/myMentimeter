/**
 * ==============================================================================
 * js/admin-home.js - Teacher home: subjects grouped by class, open quizzes
 * ==============================================================================
 */

import { getSupabase, showToast } from './supabase.js';
import { guardAdminPage, loadTeacherCourses, rememberActiveCourse, updateQuizStatus, fetchAllRows } from './admin-service.js';
import { fetchClasses, createClass, classPickerHtml, bindClassPicker, readClassPicker } from './classes.js';
import {
  escapeHtml, fmtPct, fmtDateTime, classLabel, classTitle, courseTag, percentOf, isQuizOpen,
  setBusy, friendlyError, emptyState, showFieldError, clearFieldErrors, ICONS
} from './utils.js';

let teacher = null;
let courses = [];
let quizzes = [];
let attempts = [];
let classes = [];
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
    const [courseList, quizRows, attemptRows, classList] = await Promise.all([
      loadTeacherCourses(),
      fetchAllRows(() => supabase
        .from('quizzes')
        .select('id, course_id, class_number, title, status, closes_at, scheduled_date, total_marks, question_count, quiz_attempts(count)')
        .order('id')),
      fetchAllRows(() => supabase.from('quiz_attempts').select('quiz_id, score, total_marks').order('id')),
      fetchClasses()
    ]);

    courses = courseList;
    quizzes = quizRows;
    attempts = attemptRows;
    classes = classList;

    renderMetrics();
    renderOpenQuizzes();
    renderCourses();
  } catch (err) {
    console.error(err);
    showToast('Could not load your subjects: ' + friendlyError(err), 'danger');
  }
}

function renderMetrics() {
  const active = courses.filter(c => !c.is_archived);
  const activeIds = new Set(active.map(c => c.id));
  // Every subject of a class has the same students, so count each class once
  const perClass = new Map();
  active.forEach(c => {
    const key = c.class_id || `course-${c.id}`;
    perClass.set(key, Math.max(perClass.get(key) || 0, c.student_count));
  });
  document.getElementById('metric-courses').textContent = active.length;
  document.getElementById('metric-students').textContent = [...perClass.values()].reduce((n, v) => n + v, 0);
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
        <thead><tr><th>Subject</th><th>Quiz</th><th>Submissions</th><th>Closes</th><th></th></tr></thead>
        <tbody>
          ${open.map(q => {
            const course = courseById.get(q.course_id);
            const submitted = q.quiz_attempts?.[0]?.count || 0;
            return `
              <tr>
                <td>
                  <span class="badge badge-primary">${escapeHtml(courseTag(course))}</span>
                  ${course?.class ? `<div class="small muted">${escapeHtml(classTitle(course.class))}</div>` : ''}
                </td>
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
  const container = document.getElementById('courses-grid');
  const showArchived = document.getElementById('show-archived').checked;
  const list = courses.filter(c => showArchived || !c.is_archived);
  document.getElementById('how-it-works').classList.toggle('hidden', courses.length > 2);

  if (courses.length === 0) {
    container.innerHTML = `<div class="card">${emptyState('book', 'Add the first subject you teach',
      'Choose the class (for example BBA · 1st Semester) and the subject. Every student of that class is added automatically.',
      '<button class="btn btn-primary" data-new-course>+ Add Subject</button>')}</div>`;
    container.querySelector('[data-new-course]').addEventListener('click', () => openCourseModal(null));
    return;
  }
  if (list.length === 0) {
    container.innerHTML = '<div class="card muted">All your subjects are archived. Tick "Show archived" to see them.</div>';
    return;
  }

  // Group by class, keeping the order from loadTeacherCourses (class, then name)
  const groups = new Map();
  list.forEach(c => {
    const key = c.class_id || 'none';
    if (!groups.has(key)) groups.set(key, { cls: c.class, items: [] });
    groups.get(key).items.push(c);
  });

  container.innerHTML = [...groups.values()].map(({ cls, items }) => {
    const students = Math.max(...items.map(c => c.student_count));
    return `
      <section class="class-group" aria-label="${escapeHtml(cls ? classTitle(cls) : 'Subjects without a class')}">
        <div class="class-group-head">
          <h3 class="class-group-title">${ICONS.cap}${escapeHtml(cls ? classTitle(cls) : 'Not assigned to a class yet')}</h3>
          <span class="small muted">${cls
            ? `${students} student${students === 1 ? '' : 's'} · ${items.length} subject${items.length === 1 ? '' : 's'} you teach`
            : 'Edit the subject and choose its class so students are enrolled automatically'}</span>
        </div>
        <div class="grid-cards">${items.map(courseCardHtml).join('')}</div>
      </section>`;
  }).join('');

  container.querySelectorAll('[data-edit]').forEach(btn =>
    btn.addEventListener('click', () => openCourseModal(courses.find(c => c.id === btn.dataset.edit))));
  container.querySelectorAll('[data-go]').forEach(link =>
    link.addEventListener('click', () => rememberActiveCourse(link.dataset.go)));
}

function courseCardHtml(course) {
  const cq = quizzes.filter(q => q.course_id === course.id);
  const held = cq.filter(q => q.status !== 'draft').length;
  const drafts = cq.filter(q => q.status === 'draft').length;
  const openNow = cq.filter(isQuizOpen).length;
  const quizIds = new Set(cq.map(q => q.id));
  let earned = 0, possible = 0;
  attempts.forEach(a => { if (quizIds.has(a.quiz_id)) { earned += Number(a.score); possible += Number(a.total_marks); } });
  const avg = possible > 0 ? fmtPct(percentOf(earned, possible), 0) : '–';
  const otherTeacher = course.teacher_id !== teacher.id ? course.teacher?.full_name || 'another teacher' : null;
  const meta = [course.term, otherTeacher].filter(Boolean).join(' · ');

  return `
    <div class="card course-card ${course.is_archived ? 'is-archived' : ''}">
      <div style="display: flex; justify-content: space-between; gap: 0.75rem; align-items: flex-start;">
        <div>
          <div class="course-card-code">${escapeHtml(course.code || 'Subject')}${course.is_archived ? ' · Archived' : ''}</div>
          <h4 class="course-card-name">${escapeHtml(course.name)}</h4>
          ${meta ? `<div class="course-card-meta">${escapeHtml(meta)}</div>` : ''}
        </div>
        <button class="icon-btn" title="Edit subject" data-edit="${course.id}" aria-label="Edit ${escapeHtml(course.name)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button>
      </div>

      ${openNow ? `<div><span class="badge badge-published">${openNow} quiz${openNow === 1 ? '' : 'zes'} open</span></div>` : ''}

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
}

// ------------------------------------------------------------------------------
// Subject modal
// ------------------------------------------------------------------------------

function setupCourseModal() {
  const modal = document.getElementById('course-modal');
  modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeCourseModal));
  modal.addEventListener('click', (e) => { if (e.target === modal) closeCourseModal(); });
  document.getElementById('course-form').addEventListener('submit', saveCourse);
  document.getElementById('btn-delete-course').addEventListener('click', deleteCourse);
}

function openCourseModal(course) {
  editingCourse = course;
  const form = document.getElementById('course-form');
  clearFieldErrors(form);

  // Default a new subject to the class of the teacher's most recently added subject
  const lastClass = courses
    .filter(c => !c.is_archived && c.class_id)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]?.class_id || '';
  document.getElementById('course-class-picker').innerHTML = classPickerHtml('course', classes, {
    selected: course ? (course.class_id || '') : lastClass,
    label: 'Class *',
    hint: course
      ? 'Moving a subject to another class enrolls that class. Students who already have marks keep them.'
      : 'Every student of this class is enrolled automatically — now and when they register later.'
  });
  bindClassPicker(form, 'course');

  document.getElementById('course-modal-title').textContent = course ? 'Edit Subject' : 'Add Subject';
  document.getElementById('course-code').value = course?.code || '';
  document.getElementById('course-name').value = course?.name || '';
  document.getElementById('course-term').value = course?.term || '';
  document.getElementById('course-classes').value = course?.planned_classes || 35;
  document.getElementById('course-weight').value = course?.final_weight ?? '';
  document.getElementById('course-archived').checked = Boolean(course?.is_archived);
  document.getElementById('course-edit-extras').classList.toggle('hidden', !course);
  document.getElementById('btn-delete-course').classList.toggle('hidden', !course);
  document.getElementById('course-modal').classList.add('active');
  document.getElementById(course || !lastClass ? 'course-class' : 'course-name').focus();
}

function closeCourseModal() {
  document.getElementById('course-modal').classList.remove('active');
  editingCourse = null;
}

async function saveCourse(e) {
  e.preventDefault();
  const form = e.target;
  clearFieldErrors(form);
  const btn = document.getElementById('btn-save-course');
  const nameInput = document.getElementById('course-name');

  const choice = readClassPicker(form, 'course');
  if (choice.error) {
    showFieldError(document.getElementById(choice.field), choice.error);
    return;
  }
  const name = nameInput.value.trim();
  if (name.length < 2) {
    showFieldError(nameInput, 'Enter the subject name, such as Computer Applications.');
    return;
  }

  setBusy(btn, true);
  const supabase = getSupabase();
  try {
    const classId = choice.classId || await createClass(choice);
    const weight = document.getElementById('course-weight').value;
    const payload = {
      class_id: classId,
      name,
      code: document.getElementById('course-code').value.trim() || null,
      term: document.getElementById('course-term').value.trim() || null,
      planned_classes: parseInt(document.getElementById('course-classes').value, 10) || 35,
      final_weight: weight ? Number(weight) : null
    };

    let result;
    if (editingCourse) {
      payload.is_archived = document.getElementById('course-archived').checked;
      result = await supabase.from('courses').update(payload).eq('id', editingCourse.id).select().single();
    } else {
      payload.teacher_id = teacher.id;
      result = await supabase.from('courses').insert(payload).select().single();
    }
    if (result.error) throw result.error;

    const created = !editingCourse;
    closeCourseModal();
    if (created) rememberActiveCourse(result.data.id);
    await loadAll();
    const cls = classes.find(c => c.id === classId);
    showToast(created
      ? `Subject added. Students of ${cls ? classTitle(cls) : 'the class'} are enrolled automatically.`
      : 'Subject saved.', 'success');
  } catch (err) {
    const message = friendlyError(err);
    if (/already has a subject/.test(message)) showFieldError(nameInput, message);
    else showToast('Could not save the subject: ' + message, 'danger');
  } finally {
    setBusy(btn, false);
  }
}

async function deleteCourse() {
  if (!editingCourse) return;
  const hasSubmissions = quizzes.some(q => q.course_id === editingCourse.id && (q.quiz_attempts?.[0]?.count || 0) > 0);
  if (hasSubmissions) {
    alert('Students have already submitted quizzes in this subject, so it cannot be deleted. Archive it instead to keep their marks.');
    return;
  }
  if (!confirm(`Delete ${editingCourse.name} and its quizzes? This cannot be undone.`)) return;

  const { error, count } = await getSupabase().from('courses').delete({ count: 'exact' }).eq('id', editingCourse.id);
  if (error || count === 0) {
    showToast('Could not delete the subject' + (error ? `: ${friendlyError(error)}` : '.'), 'danger');
    return;
  }
  closeCourseModal();
  showToast('Subject deleted.', 'info');
  await loadAll();
}

document.addEventListener('DOMContentLoaded', initHome);
