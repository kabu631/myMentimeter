/**
 * ==============================================================================
 * js/student-data.js - Loads everything a student page needs in three queries
 * ==============================================================================
 * Row Level Security limits every query to the signed-in student's own
 * subjects (every subject of their class, plus earlier subjects they have
 * marks in), the published/closed quizzes of those subjects, and their own attempts.
 */

import { getSupabase } from './supabase.js';
import { summarizeCourse, courseTag } from './utils.js';

export const QUIZ_COLUMNS =
  'id, course_id, class_number, title, description, scheduled_date, status, closes_at, ' +
  'time_limit_minutes, total_marks, question_count, show_score_immediately, show_correct_answers';

const COURSE_COLUMNS =
  'id, code, name, term, class_id, final_weight, is_archived, ' +
  'class:classes (id, program, semester, section), ' +
  'teacher:profiles!courses_teacher_id_fkey (full_name)';

/** @param {object} student the signed-in student's profile (needs id and class_id) */
export async function loadStudentData(student) {
  const supabase = getSupabase();

  const { data: enrollments, error: enrErr } = await supabase
    .from('enrollments')
    .select(`enrolled_at, courses (${COURSE_COLUMNS})`)
    .eq('student_id', student.id);
  if (enrErr) throw enrErr;

  // Current class first, then earlier classes; archived subjects last
  const rank = (c) => (c.is_archived ? 2 : 0) + (c.class_id === student.class_id ? 0 : 1);
  const courses = (enrollments || [])
    .filter(e => e.courses)
    .map(e => ({ ...e.courses, enrolled_at: e.enrolled_at, is_current: e.courses.class_id === student.class_id && !e.courses.is_archived }))
    .sort((a, b) => rank(a) - rank(b) || courseTag(a).localeCompare(courseTag(b), undefined, { numeric: true }));
  const courseById = new Map(courses.map(c => [c.id, c]));

  let quizzes = [];
  if (courses.length > 0) {
    const { data, error } = await supabase
      .from('quizzes')
      .select(QUIZ_COLUMNS)
      .in('course_id', courses.map(c => c.id))
      .order('class_number', { ascending: true });
    if (error) throw error;
    quizzes = data || [];
  }
  const quizById = new Map(quizzes.map(q => [q.id, q]));

  const { data: attempts, error: attErr } = await supabase
    .from('quiz_attempts')
    .select('id, quiz_id, score, total_marks, submitted_at')
    .eq('student_id', student.id)
    .order('submitted_at', { ascending: false });
  if (attErr) throw attErr;

  const attemptByQuiz = new Map((attempts || []).map(a => [a.quiz_id, a]));

  const summaries = new Map();
  for (const course of courses) {
    const courseQuizzes = quizzes.filter(q => q.course_id === course.id);
    summaries.set(course.id, summarizeCourse(courseQuizzes, attemptByQuiz, course.final_weight, course.enrolled_at));
  }

  return {
    courses,
    courseById,
    quizzes,
    quizById,
    attempts: attempts || [],
    attemptByQuiz,
    summaries
  };
}

/** Average of per-subject percentages, over subjects that have at least one counted quiz. */
export function overallAverage(summaries) {
  const counted = [...summaries.values()].filter(s => s.counted > 0);
  if (counted.length === 0) return null;
  return counted.reduce((sum, s) => sum + s.percentage, 0) / counted.length;
}
