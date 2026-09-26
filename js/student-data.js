/**
 * ==============================================================================
 * js/student-data.js - Loads everything a student page needs in three queries
 * ==============================================================================
 * Row Level Security limits every query to the signed-in student's own
 * enrollments, the published/closed quizzes of those courses, and their own attempts.
 */

import { getSupabase } from './supabase.js';
import { summarizeCourse } from './utils.js';

export const QUIZ_COLUMNS =
  'id, course_id, class_number, title, description, scheduled_date, status, closes_at, ' +
  'time_limit_minutes, total_marks, question_count, show_score_immediately, show_correct_answers';

export async function loadStudentData(studentId) {
  const supabase = getSupabase();

  const { data: enrollments, error: enrErr } = await supabase
    .from('enrollments')
    .select('enrolled_at, courses (id, code, name, section, term, final_weight, is_archived, teacher:profiles!courses_teacher_id_fkey (full_name))')
    .eq('student_id', studentId);
  if (enrErr) throw enrErr;

  const courses = (enrollments || [])
    .filter(e => e.courses)
    .map(e => ({ ...e.courses, enrolled_at: e.enrolled_at }))
    .sort((a, b) => Number(a.is_archived) - Number(b.is_archived) || a.code.localeCompare(b.code));
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
    .eq('student_id', studentId)
    .order('submitted_at', { ascending: false });
  if (attErr) throw attErr;

  const attemptByQuiz = new Map((attempts || []).map(a => [a.quiz_id, a]));

  const summaries = new Map();
  for (const course of courses) {
    const courseQuizzes = quizzes.filter(q => q.course_id === course.id);
    summaries.set(course.id, summarizeCourse(courseQuizzes, attemptByQuiz, course.final_weight));
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

/** Average of per-course percentages, over courses that have at least one counted quiz. */
export function overallAverage(summaries) {
  const counted = [...summaries.values()].filter(s => s.counted > 0);
  if (counted.length === 0) return null;
  return counted.reduce((sum, s) => sum + s.percentage, 0) / counted.length;
}
