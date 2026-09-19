/**
 * history.js - Complete Student Quiz History & Cumulative Score Engine
 */

import { getSupabase } from './supabase.js';
import { requireAuth } from './auth.js';
import { APP_CONFIG } from './config.js';

let currentUser = null;
let allQuizzes = [];
let studentAttemptsMap = new Map(); // quiz_id -> attempt record

async function initHistory() {
  currentUser = await requireAuth('student');
  if (!currentUser) return;

  const supabase = getSupabase();
  if (!supabase) return;

  try {
    // 1. Fetch all published/closed quizzes ordered by class number
    const { data: quizzes, error: quizErr } = await supabase
      .from('quizzes')
      .select('*')
      .in('status', ['published', 'closed'])
      .order('class_number', { ascending: true });

    if (quizErr) throw quizErr;
    allQuizzes = quizzes || [];

    // 2. Fetch all attempts by this student
    const { data: attempts, error: attErr } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('student_id', currentUser.id);

    if (attErr) throw attErr;

    studentAttemptsMap.clear();
    attempts?.forEach(a => studentAttemptsMap.set(a.quiz_id, a));

    // 3. Compute cumulative totals
    let totalScoreEarned = 0;
    let totalScorePossible = 0;
    let completedCount = 0;

    attempts?.forEach(a => {
      totalScoreEarned += Number(a.score || 0);
      totalScorePossible += Number(a.total_marks || 0);
      completedCount++;
    });

    const avgPct = totalScorePossible > 0 
      ? ((totalScoreEarned / totalScorePossible) * 100).toFixed(1)
      : '0.0';

    // Render Stats
    document.getElementById('hist-cumulative-score').textContent = `${totalScoreEarned.toFixed(1)} / ${totalScorePossible.toFixed(1)}`;
    document.getElementById('hist-completed-count').textContent = `${completedCount} / ${APP_CONFIG.SEMESTER_TOTAL_CLASSES}`;
    document.getElementById('hist-average-pct').textContent = `${avgPct}%`;

    const progressPct = Math.min(100, Math.round((completedCount / APP_CONFIG.SEMESTER_TOTAL_CLASSES) * 100));
    document.getElementById('hist-progress-fill').style.width = `${progressPct}%`;
    document.getElementById('hist-progress-label').textContent = `${progressPct}% Completed (${completedCount} of ${APP_CONFIG.SEMESTER_TOTAL_CLASSES} Classes)`;

    // Render Table
    renderHistoryTable(allQuizzes);

    // Filter input
    document.getElementById('history-search-input')?.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      const filtered = allQuizzes.filter(q => 
        q.title.toLowerCase().includes(term) || 
        String(q.class_number).includes(term)
      );
      renderHistoryTable(filtered);
    });

  } catch (err) {
    console.error('Error loading history:', err);
  }
}

function renderHistoryTable(quizList) {
  const tbody = document.getElementById('history-table-body');
  if (!tbody) return;

  if (quizList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state" style="padding: 2rem;">
          <div class="empty-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div>
          <div class="empty-title">No Quizzes Found</div>
          <p class="empty-text">No quizzes match your filter criteria.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = quizList.map(q => {
    const attempt = studentAttemptsMap.get(q.id);

    let statusBadge = '';
    let scoreDisplay = '-';
    let actionBtn = '';

    if (attempt) {
      const pct = attempt.total_marks > 0 ? Math.round((attempt.score / attempt.total_marks) * 100) : 0;
      const badgeClass = pct >= 80 ? 'badge-published' : pct >= 50 ? 'badge-warning' : 'badge-closed';
      statusBadge = '<span class="badge badge-published">Completed</span>';
      scoreDisplay = `<strong>${attempt.score} / ${attempt.total_marks}</strong> <span class="badge ${badgeClass}" style="margin-left: 0.35rem;">${pct}%</span>`;
      actionBtn = `<a href="results.html?attempt_id=${attempt.id}" class="btn btn-outline btn-sm">Review</a>`;
    } else {
      if (q.status === 'published') {
        statusBadge = '<span class="badge badge-warning">Available</span>';
        scoreDisplay = '<span style="color: var(--text-muted);">Not attempted</span>';
        actionBtn = `<a href="quiz.html?id=${q.id}" class="btn btn-primary btn-sm">Take Quiz</a>`;
      } else {
        statusBadge = '<span class="badge badge-closed">Closed</span>';
        scoreDisplay = '<span style="color: var(--danger);">Missed (0.0)</span>';
        actionBtn = '<span style="font-size: 0.85rem; color: var(--text-muted);">Closed</span>';
      }
    }

    return `
      <tr>
        <td><span class="badge badge-primary">Class ${String(q.class_number).padStart(2, '0')}</span></td>
        <td><strong>${q.title}</strong></td>
        <td>${q.scheduled_date}</td>
        <td>${statusBadge}</td>
        <td>${scoreDisplay}</td>
        <td>${actionBtn}</td>
      </tr>
    `;
  }).join('');
}

document.addEventListener('DOMContentLoaded', initHistory);
