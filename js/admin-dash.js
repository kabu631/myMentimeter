/**
 * admin-dash.js - Teacher / Administrator Dashboard Controller
 */

import { getSupabase, showToast } from './supabase.js';
import { requireAuth } from './auth.js';
import { exportGradebookCSV } from './export-csv.js';
import { APP_CONFIG } from './config.js';

let currentTeacher = null;
let allQuizzes = [];
let allStudents = [];
let allAttempts = [];

async function initAdmin() {
  currentTeacher = await requireAuth('teacher');
  if (!currentTeacher) return;

  setupTabs();
  await loadDashboardData();

  document.getElementById('btn-export-csv')?.addEventListener('click', exportGradebookCSV);
}

/**
 * Tab Navigation
 */
function setupTabs() {
  const tabs = document.querySelectorAll('.admin-tab-btn');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.getAttribute('data-target');
      document.getElementById(targetId)?.classList.add('active');
    });
  });
}

/**
 * Loads Quizzes, Students, and Submissions
 */
async function loadDashboardData() {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    // 1. Fetch Quizzes with Question Counts
    const { data: quizzes, error: qErr } = await supabase
      .from('quizzes')
      .select('*, questions(count)')
      .order('class_number', { ascending: true });

    if (qErr) throw qErr;
    allQuizzes = quizzes || [];

    // 2. Fetch Registered Students
    const { data: students, error: sErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'student')
      .order('student_id', { ascending: true });

    if (sErr) throw sErr;
    allStudents = students || [];

    // 3. Fetch All Quiz Attempts
    const { data: attempts, error: aErr } = await supabase
      .from('quiz_attempts')
      .select('*');

    if (aErr) throw aErr;
    allAttempts = attempts || [];

    // Render Metrics
    renderMetrics();

    // Render Tables
    renderQuizzesTable(allQuizzes);
    renderStudentsTable(allStudents);

    // Setup Search Filters
    document.getElementById('quiz-search-input')?.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      const filtered = allQuizzes.filter(q => 
        q.title.toLowerCase().includes(term) || 
        String(q.class_number).includes(term)
      );
      renderQuizzesTable(filtered);
    });

    document.getElementById('student-search-input')?.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      const filtered = allStudents.filter(s => 
        (s.full_name || '').toLowerCase().includes(term) || 
        (s.student_id || '').toLowerCase().includes(term) ||
        (s.email || '').toLowerCase().includes(term)
      );
      renderStudentsTable(filtered);
    });

  } catch (err) {
    console.error('Error loading admin data:', err);
    showToast('Failed to load dashboard data: ' + err.message, 'danger');
  }
}

/**
 * Render High-Level Metric Tiles
 */
function renderMetrics() {
  document.getElementById('metric-total-students').textContent = allStudents.length;

  const publishedCount = allQuizzes.filter(q => q.status === 'published').length;
  const draftCount = allQuizzes.filter(q => q.status === 'draft').length;
  const closedCount = allQuizzes.filter(q => q.status === 'closed').length;
  document.getElementById('metric-total-quizzes').textContent = `${publishedCount} Active (${draftCount} Drafts, ${closedCount} Closed)`;

  document.getElementById('metric-total-submissions').textContent = allAttempts.length;

  let totalScoreEarned = 0;
  let totalScorePossible = 0;
  allAttempts.forEach(a => {
    totalScoreEarned += Number(a.score || 0);
    totalScorePossible += Number(a.total_marks || 0);
  });

  const avgPct = totalScorePossible > 0 
    ? ((totalScoreEarned / totalScorePossible) * 100).toFixed(1)
    : '0.0';

  document.getElementById('metric-class-avg').textContent = `${avgPct}%`;
}

/**
 * Render Quizzes Table
 */
function renderQuizzesTable(quizList) {
  const tbody = document.getElementById('admin-quizzes-body');
  if (!tbody) return;

  if (quizList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state" style="padding: 2rem;">
          <div class="empty-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg></div>
          <div class="empty-title">No Quizzes Created Yet</div>
          <p class="empty-text">Click "Create New Quiz" to add a daily lecture quiz.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = quizList.map(q => {
    const qCount = q.questions?.[0]?.count || 0;
    const attemptCount = allAttempts.filter(a => a.quiz_id === q.id).length;

    let statusBadge = '';
    if (q.status === 'draft') statusBadge = '<span class="badge badge-draft">Draft</span>';
    else if (q.status === 'published') statusBadge = '<span class="badge badge-published">Published (Active)</span>';
    else if (q.status === 'closed') statusBadge = '<span class="badge badge-closed">Closed</span>';

    return `
      <tr>
        <td><span class="badge badge-primary">Class ${String(q.class_number).padStart(2, '0')}</span></td>
        <td>
          <strong>${q.title}</strong>
          <div style="font-size: 0.8rem; color: var(--text-muted);">${q.description ? q.description.slice(0, 50) + '...' : 'No description'}</div>
        </td>
        <td>${q.scheduled_date}</td>
        <td>${qCount} questions (${attemptCount} attempts)</td>
        <td>${statusBadge}</td>
        <td>
          <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
            ${q.status === 'draft' ? `<button class="btn btn-success btn-sm" onclick="window.updateQuizStatus('${q.id}', 'published')">Publish</button>` : ''}
            ${q.status === 'published' ? `<button class="btn btn-outline btn-sm" onclick="window.updateQuizStatus('${q.id}', 'closed')">Close</button>` : ''}
            ${q.status === 'closed' ? `<button class="btn btn-outline btn-sm" onclick="window.updateQuizStatus('${q.id}', 'published')">Reopen</button>` : ''}
            <a href="edit-quiz.html?id=${q.id}" class="btn btn-secondary btn-sm">Edit</a>
            <button class="btn btn-danger btn-sm" onclick="window.deleteQuizPrompt('${q.id}', ${attemptCount})">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Render Students & Gradebook Table
 */
function renderStudentsTable(studentList) {
  const tbody = document.getElementById('admin-students-body');
  if (!tbody) return;

  if (studentList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state" style="padding: 2rem;">
          <div class="empty-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></div>
          <div class="empty-title">No Students Registered</div>
          <p class="empty-text">Once students sign up on the registration page, their accounts will appear here.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = studentList.map(s => {
    const studentAttempts = allAttempts.filter(a => a.student_id === s.id);
    let totalScore = 0;
    let totalPossible = 0;

    studentAttempts.forEach(a => {
      totalScore += Number(a.score || 0);
      totalPossible += Number(a.total_marks || 0);
    });

    const pct = totalPossible > 0 
      ? ((totalScore / totalPossible) * 100).toFixed(1)
      : '0.0';

    return `
      <tr>
        <td><strong>${s.student_id || 'N/A'}</strong></td>
        <td>${s.full_name || 'Anonymous'}</td>
        <td>${s.email}</td>
        <td>${studentAttempts.length} / ${allQuizzes.filter(q => q.status !== 'draft').length}</td>
        <td><strong>${totalScore.toFixed(1)} / ${totalPossible.toFixed(1)}</strong></td>
        <td><span class="badge ${pct >= 75 ? 'badge-published' : pct >= 50 ? 'badge-warning' : 'badge-closed'}">${pct}%</span></td>
      </tr>
    `;
  }).join('');
}

// Global functions for inline action buttons
window.updateQuizStatus = async function(quizId, newStatus) {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('quizzes')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', quizId);

    if (error) throw error;
    showToast(`Quiz status changed to ${newStatus}.`, 'success');
    await loadDashboardData();
  } catch (err) {
    showToast('Failed to update status: ' + err.message, 'danger');
  }
};

window.deleteQuizPrompt = async function(quizId, attemptCount) {
  if (attemptCount > 0) {
    alert(`Cannot delete this quiz because students have already submitted ${attemptCount} attempt(s). Closing the quiz instead prevents any further attempts while preserving grades.`);
    return;
  }

  if (!confirm('Are you sure you want to permanently delete this quiz?')) return;

  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('quizzes')
      .delete()
      .eq('id', quizId);

    if (error) throw error;
    showToast('Quiz deleted.', 'info');
    await loadDashboardData();
  } catch (err) {
    showToast('Failed to delete quiz: ' + err.message, 'danger');
  }
};

document.addEventListener('DOMContentLoaded', initAdmin);
