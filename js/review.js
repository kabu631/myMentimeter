/**
 * ==============================================================================
 * js/review.js - Question-by-question attempt review (students and teachers)
 * ==============================================================================
 * Renders the payload of the get_student_attempt_review() database function.
 * The database decides what is revealed: students get correctness and the answer
 * key only after the quiz closes and only if the teacher allowed it.
 */

import { getSupabase } from './supabase.js';
import { escapeHtml, fmtNum, classLabel, ICONS } from './utils.js';

export async function fetchAttemptReview(attemptId) {
  const { data, error } = await getSupabase().rpc('get_student_attempt_review', { p_attempt_id: attemptId });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Could not load this attempt.');
  return data;
}

export function reviewTitle(review) {
  return `${classLabel(review.quiz.class_number)} · ${review.quiz.title}`;
}

/**
 * @param {object} review  RPC payload
 * @param {'student'|'teacher'} audience
 */
export function renderReviewHtml(review, audience = 'student') {
  const whose = audience === 'teacher' ? "Student's answer" : 'Your answer';
  let notice = '';

  if (!review.review_unlocked) {
    const text = review.quiz.show_correct_answers
      ? 'Correct answers unlock when your teacher closes this quiz. Your submitted answers are shown below.'
      : 'Your teacher has not enabled answer review for this quiz. Your submitted answers are shown below.';
    notice = `<div class="alert alert-info"><span style="width: 18px; flex-shrink: 0;">${ICONS.lock}</span><span>${text}</span></div>`;
  }

  if (!review.questions || review.questions.length === 0) {
    return notice + '<p class="muted">This quiz has no questions.</p>';
  }

  const items = review.questions.map((item, idx) => {
    const options = Array.isArray(item.options) ? item.options : [];
    const optText = (id) => options.find(o => o.id === id)?.text || '';
    const selected = item.selected_option;
    const selectedLine = selected
      ? `Option ${escapeHtml(selected)}${optText(selected) ? ` — ${escapeHtml(optText(selected))}` : ''}`
      : '<em>Not answered</em>';

    if (!review.review_unlocked) {
      return `
        <div class="card review-item" style="box-shadow: none;">
          <div class="review-head">
            <span class="muted">QUESTION ${idx + 1}</span>
            <span class="muted">${fmtNum(item.marks_possible)} mark${Number(item.marks_possible) === 1 ? '' : 's'}</span>
          </div>
          <div class="review-question">${escapeHtml(item.question_text)}</div>
          <div class="review-answer-box">
            <span class="muted">${whose}:</span> <strong class="strong">${selectedLine}</strong>
          </div>
        </div>
      `;
    }

    const correct = Boolean(item.is_correct);
    const color = correct ? 'var(--success)' : 'var(--danger)';
    const keyLine = !correct && item.correct_option
      ? `<div class="divider text-success"><strong>Correct answer:</strong> Option ${escapeHtml(item.correct_option)}${optText(item.correct_option) ? ` — ${escapeHtml(optText(item.correct_option))}` : ''}</div>`
      : '';

    return `
      <div class="card review-item ${correct ? 'review-correct' : 'review-incorrect'}" style="box-shadow: none;">
        <div class="review-head">
          <span class="muted">QUESTION ${idx + 1}</span>
          <span style="color: ${color}; display: inline-flex; align-items: center; gap: 0.35rem;">
            <span style="width: 15px; display: inline-flex;">${correct ? ICONS.check : ICONS.x}</span>
            ${correct ? 'Correct' : 'Incorrect'} · ${fmtNum(item.marks_awarded)} / ${fmtNum(item.marks_possible)}
          </span>
        </div>
        <div class="review-question">${escapeHtml(item.question_text)}</div>
        <div class="review-answer-box">
          <span class="muted">${whose}:</span> <strong style="color: ${color};">${selectedLine}</strong>
          ${keyLine}
        </div>
      </div>
    `;
  }).join('');

  return notice + items;
}
