/**
 * ==============================================================================
 * js/results.js - Student Results & Answer Review
 * ==============================================================================
 * Lists every submitted attempt (optionally filtered by course), shows the
 * semester summary for the selection, and opens a question-by-question review.
 * Query params: ?course=<id> preselects a course, ?attempt=<id> opens a review.
 */

import { showToast } from './supabase.js';
import { requireAuth } from './auth.js';
import { loadStudentData, overallAverage } from './student-data.js';
import { fetchAttemptReview, renderReviewHtml, reviewTitle } from './review.js';
import {
  escapeHtml, fmtNum, fmtPct, fmtDateTime, classLabel, courseLabel, percentOf, pctBadgeClass,
  isScoreVisible, emptyState, friendlyError
} from './utils.js';

let data = null;
let selectedCourse = 'all';

async function initResults() {
  const user = await requireAuth('student');
  if (!user) return;

  const params = new URLSearchParams(window.location.search);

  try {
    data = await loadStudentData(user.id);
  } catch (err) {
    showToast('Could not load results: ' + friendlyError(err), 'danger');
    return;
  }

  const select = document.getElementById('course-filter');
  data.courses.forEach(c => select.add(new Option(courseLabel(c), c.id)));
  if (params.get('course') && data.courseById.has(params.get('course'))) {
    selectedCourse = params.get('course');
    select.value = selectedCourse;
  }
  select.addEventListener('change', () => {
    selectedCourse = select.value;
    const url = new URL(window.location.href);
    if (selectedCourse === 'all') url.searchParams.delete('course');
    else url.searchParams.set('course', selectedCourse);
    history.replaceState(null, '', url);
    render();
  });

  render();
  setupModal();

  if (params.get('attempt')) openReview(params.get('attempt'));
}

function render() {
  renderSummary();
  renderTable();
}

function renderSummary() {
  const finalCard = document.getElementById('summary-final-card');
  if (selectedCourse === 'all') {
    let attempted = 0, counted = 0, earned = 0, possible = 0;
    data.summaries.forEach(s => { attempted += s.attempted; counted += s.counted; earned += s.earned; possible += s.possible; });
    const avg = overallAverage(data.summaries);
    document.getElementById('summary-taken').textContent = `${attempted} / ${counted}`;
    document.getElementById('summary-marks').textContent = `${fmtNum(earned)} / ${fmtNum(possible)}`;
    document.getElementById('summary-percentage').textContent = avg === null ? '–' : fmtPct(avg);
    finalCard.classList.add('hidden');
    return;
  }

  const course = data.courseById.get(selectedCourse);
  const s = data.summaries.get(selectedCourse);
  document.getElementById('summary-taken').textContent = `${s.attempted} / ${s.counted}`;
  document.getElementById('summary-marks').textContent = `${fmtNum(s.earned)} / ${fmtNum(s.possible)}`;
  document.getElementById('summary-percentage').textContent = s.counted ? fmtPct(s.percentage) : '–';
  if (course.final_weight) {
    document.getElementById('summary-final').textContent = s.counted
      ? `${fmtNum(s.weighted)} / ${fmtNum(course.final_weight)}`
      : `– / ${fmtNum(course.final_weight)}`;
    finalCard.classList.remove('hidden');
  } else {
    finalCard.classList.add('hidden');
  }
}

function renderTable() {
  const tbody = document.getElementById('attempts-table-body');
  const list = data.attempts.filter(a => {
    const quiz = data.quizById.get(a.quiz_id);
    return quiz && (selectedCourse === 'all' || quiz.course_id === selectedCourse);
  });

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">${emptyState('book', 'No quizzes submitted yet',
      'When you submit a quiz, your score and answers will be listed here.')}</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(att => {
    const quiz = data.quizById.get(att.quiz_id);
    const course = data.courseById.get(quiz.course_id);
    const visible = isScoreVisible(quiz);
    const pct = percentOf(Number(att.score), Number(att.total_marks));
    return `
      <tr>
        <td><span class="badge badge-primary">${escapeHtml(course?.code || '')}</span></td>
        <td class="nowrap hide-sm">${classLabel(quiz.class_number)}</td>
        <td><strong class="strong">${escapeHtml(quiz.title)}</strong></td>
        <td class="nowrap">${visible ? `<strong class="text-success">${fmtNum(att.score)}</strong> / ${fmtNum(att.total_marks)}` : '<span class="small muted">After quiz closes</span>'}</td>
        <td>${visible ? `<span class="badge ${pctBadgeClass(pct)}">${fmtPct(pct, 0)}</span>` : '–'}</td>
        <td class="small nowrap hide-sm">${fmtDateTime(att.submitted_at)}</td>
        <td><button class="btn btn-outline btn-sm" data-review="${att.id}">Review &rarr;</button></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-review]').forEach(btn => {
    btn.addEventListener('click', () => openReview(btn.dataset.review));
  });
}

async function openReview(attemptId) {
  const modal = document.getElementById('quiz-detail-modal');
  const body = document.getElementById('modal-questions-container');
  const badge = document.getElementById('modal-detail-score-badge');
  document.getElementById('modal-detail-title').textContent = 'Quiz review';
  badge.textContent = '';
  body.innerHTML = '<p class="muted" style="text-align: center; padding: 2rem;">Loading your answers...</p>';
  modal.classList.add('active');

  try {
    const review = await fetchAttemptReview(attemptId);
    document.getElementById('modal-detail-title').textContent = reviewTitle(review);
    const quiz = data?.quizById.get(review.quiz.id) || review.quiz;
    if (isScoreVisible(quiz)) {
      const pct = percentOf(Number(review.attempt.score), Number(review.attempt.total_marks));
      badge.textContent = `Score: ${fmtNum(review.attempt.score)} / ${fmtNum(review.attempt.total_marks)} (${fmtPct(pct, 0)})`;
      badge.className = `badge ${pctBadgeClass(pct)}`;
    } else {
      badge.textContent = 'Score released when the quiz closes';
      badge.className = 'badge badge-draft';
    }
    body.innerHTML = renderReviewHtml(review, 'student');
  } catch (err) {
    body.innerHTML = `<div class="alert alert-danger">${escapeHtml(friendlyError(err))}</div>`;
  }
}

function setupModal() {
  const modal = document.getElementById('quiz-detail-modal');
  const close = () => modal.classList.remove('active');
  document.getElementById('btn-close-modal').addEventListener('click', close);
  document.getElementById('btn-modal-done').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

document.addEventListener('DOMContentLoaded', initResults);
