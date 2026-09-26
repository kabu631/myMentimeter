/**
 * ==============================================================================
 * js/admin-service.js - Shared data helpers for the teacher console
 * ==============================================================================
 * Every query here is filtered by Row Level Security: teachers only ever see
 * their own courses, quizzes, students and attempts (admins see all).
 */

import { getSupabase, showToast } from './supabase.js';
import { requireAuth } from './auth.js';
import { courseLabel, escapeHtml, friendlyError, summarizeCourse } from './utils.js';

const ACTIVE_COURSE_KEY = 'dcq_active_course';

/** Guard for every teacher page. Returns the teacher's profile or null (after redirecting). */
export async function guardAdminPage() {
  return requireAuth('teacher');
}

/** All courses visible to this teacher, active first, with student counts. */
export async function loadTeacherCourses() {
  const { data, error } = await getSupabase()
    .from('courses')
    .select('*, enrollments(count), teacher:profiles!courses_teacher_id_fkey(full_name)')
    .order('is_archived', { ascending: true })
    .order('code', { ascending: true });
  if (error) throw error;
  return (data || []).map(c => ({ ...c, student_count: c.enrollments?.[0]?.count || 0 }));
}

/**
 * Picks the course to show: ?course= in the URL, then the last one used, then the first active one.
 */
export function pickActiveCourseId(courses) {
  const fromUrl = new URLSearchParams(window.location.search).get('course');
  let stored = null;
  try { stored = localStorage.getItem(ACTIVE_COURSE_KEY); } catch { /* storage blocked */ }
  const ids = new Set(courses.map(c => c.id));
  if (fromUrl && ids.has(fromUrl)) return fromUrl;
  if (stored && ids.has(stored)) return stored;
  return (courses.find(c => !c.is_archived) || courses[0])?.id || null;
}

export function rememberActiveCourse(courseId) {
  try { localStorage.setItem(ACTIVE_COURSE_KEY, courseId); } catch { /* storage blocked */ }
  const url = new URL(window.location.href);
  url.searchParams.set('course', courseId);
  history.replaceState(null, '', url);
}

/**
 * Renders the "Course: [select]" bar into `container`. Calls onChange(courseId) on switch.
 */
export function renderCourseSwitcher(container, courses, activeId, onChange) {
  container.innerHTML = `
    <div class="course-switcher">
      <label for="course-switcher-select">Course</label>
      <select id="course-switcher-select" class="form-select">
        ${courses.map(c => `<option value="${c.id}" ${c.id === activeId ? 'selected' : ''}>${escapeHtml(courseLabel(c))}${c.is_archived ? ' — archived' : ''}</option>`).join('')}
      </select>
      <a href="index.html" class="btn btn-outline btn-sm">Manage courses</a>
    </div>
  `;
  container.querySelector('select').addEventListener('change', (e) => {
    rememberActiveCourse(e.target.value);
    onChange(e.target.value);
  });
  rememberActiveCourse(activeId);
}

/** Empty state shown on course-scoped pages before the teacher has any course. */
export function noCoursesHtml() {
  return `
    <div class="card empty-state">
      <div class="empty-title">Create your first course</div>
      <p class="empty-text">Quizzes, students and grades are organised by course. Create one to get a join code for your students.</p>
      <a href="index.html?new=1" class="btn btn-primary">Create a course</a>
    </div>
  `;
}

/**
 * Supabase caps each response (1000 rows by default). Page through a query so large
 * gradebooks are never silently truncated. `buildQuery` must return a fresh, ordered query.
 */
export async function fetchAllRows(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

/**
 * Everything needed for a course gradebook: enrolled students, quizzes, attempts,
 * and each student's semester summary (see summarizeCourse in utils.js).
 */
export async function loadCourseGradebook(course) {
  const supabase = getSupabase();
  const [enrollments, quizRes] = await Promise.all([
    fetchAllRows(() => supabase
      .from('enrollments')
      .select('enrolled_at, profiles (id, full_name, student_id, section, email)')
      .eq('course_id', course.id)
      .order('student_id', { ascending: true })),
    supabase
      .from('quizzes')
      .select('*')
      .eq('course_id', course.id)
      .order('class_number', { ascending: true })
  ]);
  if (quizRes.error) throw quizRes.error;

  const students = enrollments
    .filter(e => e.profiles)
    .map(e => ({ ...e.profiles, enrolled_at: e.enrolled_at }))
    .sort((a, b) => String(a.student_id || a.full_name).localeCompare(String(b.student_id || b.full_name), undefined, { numeric: true }));
  const quizzes = quizRes.data || [];

  const quizIds = quizzes.map(q => q.id);
  const attempts = quizIds.length === 0 ? [] : await fetchAllRows(() => supabase
    .from('quiz_attempts')
    .select('id, quiz_id, student_id, score, total_marks, submitted_at')
    .in('quiz_id', quizIds)
    .order('id', { ascending: true }));

  const attemptsByStudent = new Map();
  attempts.forEach(a => {
    if (!attemptsByStudent.has(a.student_id)) attemptsByStudent.set(a.student_id, new Map());
    attemptsByStudent.get(a.student_id).set(a.quiz_id, a);
  });

  const summaries = new Map(students.map(s => [
    s.id,
    summarizeCourse(quizzes, attemptsByStudent.get(s.id) || new Map(), course.final_weight)
  ]));

  return { students, quizzes, attempts, attemptsByStudent, summaries };
}

/** Change a quiz's lifecycle status. Reopening clears an automatic close time that has already passed. */
export async function updateQuizStatus(quiz, newStatus) {
  const patch = { status: newStatus, updated_at: new Date().toISOString() };
  if (newStatus === 'published' && quiz.closes_at && new Date(quiz.closes_at) < new Date()) {
    patch.closes_at = null;
  }
  if (newStatus === 'published' && !quiz.question_count) {
    showToast('Add at least one question before publishing.', 'warning');
    return false;
  }

  const { error } = await getSupabase().from('quizzes').update(patch).eq('id', quiz.id);
  if (error) {
    showToast('Could not update the quiz: ' + friendlyError(error), 'danger');
    return false;
  }
  const label = { published: 'published — students can take it now', closed: 'closed', draft: 'moved to drafts' }[newStatus];
  showToast(`Quiz ${label}.`, 'success');
  return true;
}

/** Deletes a quiz that has no submissions (the database refuses otherwise). */
export async function deleteQuiz(quiz, attemptCount) {
  if (attemptCount > 0) {
    alert(`This quiz has ${attemptCount} submission(s), so it can't be deleted — that would erase student marks. Close it instead to stop new attempts.`);
    return false;
  }
  if (!confirm(`Delete "${quiz.title}" and all its questions? This cannot be undone.`)) return false;

  const { error, count } = await getSupabase().from('quizzes').delete({ count: 'exact' }).eq('id', quiz.id);
  if (error || count === 0) {
    showToast('Could not delete the quiz' + (error ? `: ${friendlyError(error)}` : '.'), 'danger');
    return false;
  }
  showToast('Quiz deleted.', 'info');
  return true;
}
