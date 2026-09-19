/**
 * ==============================================================================
 * js/admin-results.js - Faculty Semester Results & Gradebook Engine
 * ==============================================================================
 * Features:
 * 1. Complete Class Result View:
 *    - Matrix table: Student ID | Student Name | Section | Q01 | ... | Q35 | Total Earned | Total Possible | Percentage
 *    - Pinned/Sticky Student ID & Name columns for easy horizontal scrolling
 *    - Class average footer row
 * 2. Filters:
 *    - Section
 *    - Student (name / roll number search)
 *    - Quiz (highlight or single-quiz focus)
 *    - Date (date picker filter)
 * 3. Individual Student Result View:
 *    - High-density student performance report
 *    - Complete quiz history breakdown
 *    - Question-by-question answer inspector modal
 * 4. Dual CSV Export:
 *    - Complete 35-class semester matrix CSV (RFC 4180)
 *    - Filtered results CSV
 *    - Individual student report CSV
 * 5. Strict Security:
 *    - Guarded by teacher/admin role authentication.
 */

import { getSupabase, showToast } from './supabase.js';
import { guardAdminPage } from './admin-service.js';
import { APP_CONFIG } from './config.js';

// State variables
let allStudents = [];
let allQuizzes = [];
let allAttempts = [];
let quizByClass = new Map();
let attemptByStudentQuiz = new Map();
let availableSections = [];

// Filter state
let filterState = {
  section: 'all',
  studentQuery: '',
  quizFilter: 'all',
  dateFilter: '',
  activeView: 'matrix' // 'matrix' or 'individual'
};

let currentSelectedStudentId = null;

/**
 * Initialize Semester Results Dashboard
 */
export async function initAdminResultsDashboard() {
  const admin = await guardAdminPage();
  if (!admin) return;

  await loadAllResultsData();
  setupEventListeners();
  renderDashboard();
}

/**
 * Load students, quizzes, and all attempts from Supabase
 */
async function loadAllResultsData() {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const [studentsRes, quizzesRes, attemptsRes] = await Promise.all([
      // 1. Fetch all registered students
      supabase
        .from('profiles')
        .select('*')
        .eq('role', 'student')
        .order('student_id', { ascending: true }),

      // 2. Fetch all quizzes
      supabase
        .from('quizzes')
        .select('*')
        .order('class_number', { ascending: true }),

      // 3. Fetch all attempts
      supabase
        .from('quiz_attempts')
        .select(`
          id,
          student_id,
          quiz_id,
          score,
          total_marks,
          submitted_at,
          status
        `)
    ]);

    if (studentsRes.error) throw studentsRes.error;
    if (quizzesRes.error) throw quizzesRes.error;
    if (attemptsRes.error) throw attemptsRes.error;

    allStudents = studentsRes.data || [];
    allQuizzes = quizzesRes.data || [];
    allAttempts = attemptsRes.data || [];

    // Build Maps
    quizByClass.clear();
    allQuizzes.forEach(q => quizByClass.set(Number(q.class_number), q));

    attemptByStudentQuiz.clear();
    allAttempts.forEach(a => {
      attemptByStudentQuiz.set(`${a.student_id}_${a.quiz_id}`, a);
    });

    // Extract unique sections
    const sectionSet = new Set();
    allStudents.forEach(s => {
      const sec = s.section || 'A';
      if (sec) sectionSet.add(sec.trim());
    });
    availableSections = Array.from(sectionSet).sort();

    populateFilterDropdowns();

  } catch (err) {
    console.error('Error loading admin results data:', err);
    showToast('Failed to load results: ' + err.message, 'danger');
  }
}

/**
 * Populate Section, Quiz, and Student filter dropdowns
 */
function populateFilterDropdowns() {
  // 1. Section Filter
  const sectionSelect = document.getElementById('filter-section');
  if (sectionSelect) {
    sectionSelect.innerHTML = '<option value="all">All Sections</option>';
    availableSections.forEach(sec => {
      const opt = document.createElement('option');
      opt.value = sec;
      opt.textContent = `Section ${sec}`;
      sectionSelect.appendChild(opt);
    });
  }

  // 2. Quiz Filter
  const quizSelect = document.getElementById('filter-quiz');
  if (quizSelect) {
    quizSelect.innerHTML = '<option value="all">All Quizzes (Q01 – Q35 Matrix)</option>';
    allQuizzes.forEach(q => {
      const opt = document.createElement('option');
      opt.value = q.id;
      opt.textContent = `Class ${String(q.class_number).padStart(2, '0')}: ${q.title}`;
      quizSelect.appendChild(opt);
    });
  }

  // 3. Individual Student Select
  const studentSelect = document.getElementById('individual-student-select');
  if (studentSelect) {
    studentSelect.innerHTML = '<option value="">Select a student to view details...</option>';
    allStudents.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.student_id || 'ID'} — ${s.full_name || 'Student'} (Sec: ${s.section || 'A'})`;
      studentSelect.appendChild(opt);
    });
  }
}

/**
 * Sets up event listeners for filters, search, tabs, and exports
 */
function setupEventListeners() {
  // Section filter
  document.getElementById('filter-section')?.addEventListener('change', (e) => {
    filterState.section = e.target.value;
    renderDashboard();
  });

  // Student search
  document.getElementById('filter-student')?.addEventListener('input', (e) => {
    filterState.studentQuery = e.target.value.toLowerCase().trim();
    renderDashboard();
  });

  // Quiz filter
  document.getElementById('filter-quiz')?.addEventListener('change', (e) => {
    filterState.quizFilter = e.target.value;
    renderDashboard();
  });

  // Date filter
  document.getElementById('filter-date')?.addEventListener('change', (e) => {
    filterState.dateFilter = e.target.value;
    renderDashboard();
  });

  // Clear date filter
  document.getElementById('btn-clear-date')?.addEventListener('click', () => {
    const input = document.getElementById('filter-date');
    if (input) input.value = '';
    filterState.dateFilter = '';
    renderDashboard();
  });

  // Reset all filters
  document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
    filterState.section = 'all';
    filterState.studentQuery = '';
    filterState.quizFilter = 'all';
    filterState.dateFilter = '';

    if (document.getElementById('filter-section')) document.getElementById('filter-section').value = 'all';
    if (document.getElementById('filter-student')) document.getElementById('filter-student').value = '';
    if (document.getElementById('filter-quiz')) document.getElementById('filter-quiz').value = 'all';
    if (document.getElementById('filter-date')) document.getElementById('filter-date').value = '';

    renderDashboard();
  });

  // View switchers
  document.getElementById('tab-btn-matrix')?.addEventListener('click', () => {
    switchView('matrix');
  });

  document.getElementById('tab-btn-individual')?.addEventListener('click', () => {
    if (!currentSelectedStudentId && allStudents.length > 0) {
      currentSelectedStudentId = allStudents[0].id;
      const select = document.getElementById('individual-student-select');
      if (select) select.value = currentSelectedStudentId;
    }
    switchView('individual');
  });

  // Individual student select dropdown
  document.getElementById('individual-student-select')?.addEventListener('change', (e) => {
    currentSelectedStudentId = e.target.value;
    renderIndividualStudentView();
  });

  // Return to matrix view from individual panel
  document.getElementById('btn-back-to-matrix')?.addEventListener('click', () => {
    switchView('matrix');
  });

  // Scroll helper buttons
  document.getElementById('btn-scroll-start')?.addEventListener('click', () => {
    const container = document.getElementById('matrix-scroll-wrapper');
    if (container) container.scrollTo({ left: 0, behavior: 'smooth' });
  });

  document.getElementById('btn-scroll-mid')?.addEventListener('click', () => {
    const container = document.getElementById('matrix-scroll-wrapper');
    if (container) container.scrollTo({ left: 900, behavior: 'smooth' });
  });

  document.getElementById('btn-scroll-end')?.addEventListener('click', () => {
    const container = document.getElementById('matrix-scroll-wrapper');
    if (container) container.scrollTo({ left: container.scrollWidth, behavior: 'smooth' });
  });

  // CSV Export buttons
  document.getElementById('btn-export-semester')?.addEventListener('click', exportSemesterMatrixCSV);
  document.getElementById('btn-export-filtered')?.addEventListener('click', exportFilteredMatrixCSV);
  document.getElementById('btn-export-student')?.addEventListener('click', exportCurrentStudentCSV);

  // Modal close handlers
  document.getElementById('btn-close-answer-modal')?.addEventListener('click', closeAnswerModal);
  document.getElementById('btn-modal-answer-done')?.addEventListener('click', closeAnswerModal);
  document.getElementById('quiz-answer-inspector-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'quiz-answer-inspector-modal') closeAnswerModal();
  });
}

function switchView(viewName) {
  filterState.activeView = viewName;
  const matrixTab = document.getElementById('tab-btn-matrix');
  const individualTab = document.getElementById('tab-btn-individual');
  const matrixPane = document.getElementById('view-matrix-pane');
  const individualPane = document.getElementById('view-individual-pane');

  if (viewName === 'matrix') {
    matrixTab?.classList.add('active');
    individualTab?.classList.remove('active');
    matrixPane.style.display = 'block';
    individualPane.style.display = 'none';
  } else {
    individualTab?.classList.add('active');
    matrixTab?.classList.remove('active');
    matrixPane.style.display = 'none';
    individualPane.style.display = 'block';
    renderIndividualStudentView();
  }
}

/**
 * Filter students based on filterState
 */
function getFilteredStudents() {
  return allStudents.filter(student => {
    // 1. Section Filter
    if (filterState.section !== 'all') {
      const studentSec = (student.section || 'A').trim();
      if (studentSec.toLowerCase() !== filterState.section.toLowerCase()) return false;
    }

    // 2. Student Search Filter
    if (filterState.studentQuery) {
      const name = (student.full_name || '').toLowerCase();
      const sId = (student.student_id || '').toLowerCase();
      const email = (student.email || '').toLowerCase();
      const q = filterState.studentQuery;
      if (!name.includes(q) && !sId.includes(q) && !email.includes(q)) return false;
    }

    // 3. Date Filter (matches if student attempted any quiz on this date or quiz scheduled date)
    if (filterState.dateFilter) {
      let hasDateMatch = false;
      for (const [classNum, quiz] of quizByClass.entries()) {
        if (quiz.scheduled_date === filterState.dateFilter) {
          hasDateMatch = true;
          break;
        }
      }
      if (!hasDateMatch) return false;
    }

    return true;
  });
}

/**
 * Renders the entire dashboard: KPI metrics & active view
 */
function renderDashboard() {
  renderKPICards();

  if (filterState.activeView === 'matrix') {
    renderSemesterMatrixTable();
  } else {
    renderIndividualStudentView();
  }
}

/**
 * Renders top KPI cards
 */
function renderKPICards() {
  const filteredStudents = getFilteredStudents();
  let totalScoreEarnedAll = 0;
  let totalScorePossibleAll = 0;

  filteredStudents.forEach(s => {
    allQuizzes.forEach(q => {
      const att = attemptByStudentQuiz.get(`${s.id}_${q.id}`);
      if (att) {
        totalScoreEarnedAll += Number(att.score || 0);
        totalScorePossibleAll += Number(att.total_marks || 0);
      }
    });
  });

  const avgPct = totalScorePossibleAll > 0 
    ? ((totalScoreEarnedAll / totalScorePossibleAll) * 100).toFixed(1) 
    : '0.0';

  document.getElementById('metric-total-students').textContent = filteredStudents.length;
  document.getElementById('metric-total-quizzes').textContent = `${allQuizzes.length} / 35`;
  document.getElementById('metric-class-avg').textContent = `${avgPct}%`;
  document.getElementById('metric-total-attempts').textContent = allAttempts.length;
}

/**
 * Renders Complete Class Matrix Table (Q01 to Q35)
 */
function renderSemesterMatrixTable() {
  const theadRow = document.getElementById('matrix-table-head-row');
  const tbody = document.getElementById('matrix-table-body');
  const tfootRow = document.getElementById('matrix-table-foot-row');
  if (!theadRow || !tbody) return;

  const filteredStudents = getFilteredStudents();

  // 1. Build Header Row (Student ID | Student Name | Section | Q01 .. Q35 | Total Earned | Total Possible | Percentage | Action)
  let headHtml = `
    <th class="sticky-id">Student ID</th>
    <th class="sticky-name">Student Name</th>
    <th style="min-width: 70px;">Section</th>
  `;

  for (let c = 1; c <= 35; c++) {
    const q = quizByClass.get(c);
    const qNum = String(c).padStart(2, '0');
    const isTargetQuiz = (filterState.quizFilter !== 'all' && q && q.id === filterState.quizFilter);
    const highlightStyle = isTargetQuiz ? 'background: #312e81; color: #a5b4fc; border: 2px solid var(--primary);' : '';
    const titleAttr = q ? `Class ${qNum}: ${escapeHtml(q.title)} (${q.scheduled_date})` : `Class ${qNum}: Not Created Yet`;

    headHtml += `
      <th class="matrix-col-q" style="${highlightStyle}" title="${titleAttr}">
        Q${qNum}
      </th>
    `;
  }

  headHtml += `
    <th style="min-width: 95px; background: #0f172a; color: var(--success); font-weight: 700;">Total Earned</th>
    <th style="min-width: 95px; background: #0f172a; color: var(--text-secondary); font-weight: 700;">Total Possible</th>
    <th style="min-width: 95px; background: #0f172a; color: var(--primary); font-weight: 700;">Percentage</th>
    <th style="min-width: 90px; background: #0f172a;">Action</th>
  `;

  theadRow.innerHTML = headHtml;

  // 2. Build Data Rows
  if (filteredStudents.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="43" class="empty-state" style="padding: 3rem 1rem;">
          <div class="empty-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          <div class="empty-title">No Students Match Selected Filters</div>
          <p class="empty-text">Try resetting the Section, Search, or Date filters.</p>
        </td>
      </tr>
    `;
    if (tfootRow) tfootRow.innerHTML = '';
    return;
  }

  // Column sum accumulators for footer
  const colScoresSum = Array(36).fill(0);
  const colAttemptsCount = Array(36).fill(0);
  let overallEarnedSum = 0;
  let overallPossibleSum = 0;

  const rowsHtml = filteredStudents.map(student => {
    let studentEarned = 0;
    let studentPossible = 0;
    let scoresCellsHtml = '';

    for (let c = 1; c <= 35; c++) {
      const q = quizByClass.get(c);
      let cellContent = '<span class="score-pill score-none">-</span>';

      if (q) {
        const att = attemptByStudentQuiz.get(`${student.id}_${q.id}`);
        if (att) {
          const sc = Number(att.score || 0);
          const tot = Number(att.total_marks || 0);
          studentEarned += sc;
          studentPossible += tot;

          colScoresSum[c] += sc;
          colAttemptsCount[c] += 1;

          const pct = tot > 0 ? (sc / tot) * 100 : 0;
          const colorClass = pct >= 80 ? 'score-high' : pct >= 50 ? 'score-mid' : 'score-low';

          const formattedScore = Number.isInteger(sc) ? sc : sc.toFixed(1);
          cellContent = `
            <span class="score-pill ${colorClass}" title="Class ${c}: ${formattedScore}/${tot} pts (${pct.toFixed(0)}%)">
              ${formattedScore}
            </span>
          `;
        }
      }

      scoresCellsHtml += `<td class="matrix-col-q">${cellContent}</td>`;
    }

    overallEarnedSum += studentEarned;
    overallPossibleSum += studentPossible;

    const studentPct = studentPossible > 0 
      ? ((studentEarned / studentPossible) * 100).toFixed(2) 
      : '0.00';

    const pctBadgeClass = Number(studentPct) >= 80 ? 'badge-published' : Number(studentPct) >= 50 ? 'badge-warning' : 'badge-closed';

    return `
      <tr>
        <td class="sticky-id">
          <a href="javascript:void(0)" onclick="window.viewStudentResults('${student.id}')" style="color: var(--primary); font-family: var(--font-heading); text-decoration: none;">
            ${escapeHtml(student.student_id || 'ID')}
          </a>
        </td>
        <td class="sticky-name">
          <a href="javascript:void(0)" onclick="window.viewStudentResults('${student.id}')" style="color: var(--text-primary); text-decoration: none;">
            ${escapeHtml(student.full_name || 'Student')}
          </a>
        </td>
        <td>
          <span class="badge badge-primary">${escapeHtml(student.section || 'A')}</span>
        </td>
        ${scoresCellsHtml}
        <td style="font-weight: 700; color: var(--success); font-size: 0.95rem;">
          ${Number.isInteger(studentEarned) ? studentEarned : studentEarned.toFixed(2)}
        </td>
        <td style="font-weight: 600; color: var(--text-muted); font-size: 0.95rem;">
          ${Number.isInteger(studentPossible) ? studentPossible : studentPossible.toFixed(2)}
        </td>
        <td>
          <span class="badge ${pctBadgeClass}" style="font-size: 0.85rem;">${studentPct}%</span>
        </td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="window.viewStudentResults('${student.id}')">
            View &rarr;
          </button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = rowsHtml;

  // 3. Build Footer Row (Class Averages)
  if (tfootRow) {
    let footHtml = `
      <th class="sticky-id" style="background: #020617; color: var(--text-muted); text-transform: uppercase; font-size: 0.75rem;">Class Avg</th>
      <th class="sticky-name" style="background: #020617; color: var(--text-muted); font-size: 0.8rem;">Average Across Students</th>
      <th style="background: #020617; color: var(--text-muted);">-</th>
    `;

    for (let c = 1; c <= 35; c++) {
      const count = colAttemptsCount[c];
      const sum = colScoresSum[c];
      const avg = count > 0 ? (sum / count).toFixed(1) : '-';
      footHtml += `
        <th class="matrix-col-q" style="background: #020617; color: var(--text-secondary); font-size: 0.8rem;">
          ${avg}
        </th>
      `;
    }

    const nStudents = filteredStudents.length;
    const avgEarned = nStudents > 0 ? (overallEarnedSum / nStudents).toFixed(1) : '0.0';
    const avgPossible = nStudents > 0 ? (overallPossibleSum / nStudents).toFixed(1) : '0.0';
    const overallPct = overallPossibleSum > 0 ? ((overallEarnedSum / overallPossibleSum) * 100).toFixed(2) : '0.00';

    footHtml += `
      <th style="background: #020617; color: var(--success); font-weight: 700;">${avgEarned}</th>
      <th style="background: #020617; color: var(--text-muted); font-weight: 700;">${avgPossible}</th>
      <th style="background: #020617; color: var(--primary); font-weight: 700;">${overallPct}%</th>
      <th style="background: #020617;">-</th>
    `;

    tfootRow.innerHTML = footHtml;
  }
}

/**
 * Expose viewStudentResults globally for inline clicks
 */
window.viewStudentResults = function(studentId) {
  currentSelectedStudentId = studentId;
  const select = document.getElementById('individual-student-select');
  if (select) select.value = studentId;
  switchView('individual');
};

/**
 * Renders the Individual Student Result View
 */
function renderIndividualStudentView() {
  const container = document.getElementById('student-individual-content');
  if (!container) return;

  if (!currentSelectedStudentId) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 3rem 1rem;">
        <div class="empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
        </div>
        <div class="empty-title">Select a Student</div>
        <p class="empty-text">Choose a student from the dropdown above or click on any row in the Class Matrix.</p>
      </div>
    `;
    return;
  }

  const student = allStudents.find(s => s.id === currentSelectedStudentId);
  if (!student) {
    container.innerHTML = '<div class="alert alert-danger">Student record not found.</div>';
    return;
  }

  // Calculate student specific semester stats
  let totalEarned = 0;
  let totalPossible = 0;
  let attemptedCount = 0;

  const quizRows = allQuizzes.map(quiz => {
    const att = attemptByStudentQuiz.get(`${student.id}_${quiz.id}`);
    const isAttempted = Boolean(att);

    if (isAttempted) {
      totalEarned += Number(att.score || 0);
      totalPossible += Number(att.total_marks || 0);
      attemptedCount++;
    }

    const sc = isAttempted ? Number(att.score || 0) : 0;
    const tot = isAttempted ? Number(att.total_marks || 0) : 0;
    const pct = tot > 0 ? ((sc / tot) * 100).toFixed(1) : '0.0';
    const subTime = isAttempted 
      ? new Date(att.submitted_at).toLocaleString() 
      : 'Unattempted';

    const badgeClass = isAttempted ? 'badge-published' : 'badge-closed';
    const statusText = isAttempted ? 'Completed' : 'Not Attempted';

    return {
      quiz,
      att,
      isAttempted,
      score: sc,
      total: tot,
      percentage: pct,
      subTime,
      badgeClass,
      statusText
    };
  });

  const percentage = totalPossible > 0 
    ? ((totalEarned / totalPossible) * 100).toFixed(2) 
    : '0.00';

  const formatNum = (n) => Number.isInteger(n) ? n : n.toFixed(2);

  container.innerHTML = `
    <!-- Student Profile Header Banner -->
    <div class="card" style="background: radial-gradient(circle at top left, rgba(79, 70, 229, 0.08), var(--bg-card)); padding: 1.75rem 2rem; margin-bottom: 1.75rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1.5rem;">
        <div>
          <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">
            Individual Student Performance Report
          </div>
          <h2 style="font-size: 2rem; margin-bottom: 0.35rem; color: var(--text-primary);">
            ${escapeHtml(student.full_name || 'Student')}
          </h2>
          <div style="display: flex; gap: 1.5rem; flex-wrap: wrap; font-size: 0.95rem; color: var(--text-secondary); margin-top: 0.5rem;">
            <span>Roll ID: <strong style="color: var(--text-primary);">${escapeHtml(student.student_id || 'N/A')}</strong></span>
            <span>Section: <strong style="color: var(--text-primary);">${escapeHtml(student.section || 'A')}</strong></span>
            <span>Email: <span style="color: var(--text-muted);">${escapeHtml(student.email || 'N/A')}</span></span>
          </div>
        </div>

        <div style="display: flex; gap: 0.75rem;">
          <button class="btn btn-secondary btn-sm" onclick="window.exportCurrentStudentCSV()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export Student Report (CSV)
          </button>
        </div>
      </div>
    </div>

    <!-- Student KPI Summary Tiles -->
    <div class="stat-grid" style="margin-bottom: 2rem; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
      <div class="stat-card">
        <div class="stat-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
            <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
            <path d="M4 22h16"/>
            <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
            <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
            <path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>
          </svg>
        </div>
        <div class="stat-content">
          <div class="stat-value" style="color: var(--success);">${formatNum(totalEarned)}</div>
          <div class="stat-label">Total Earned Marks</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
          </svg>
        </div>
        <div class="stat-content">
          <div class="stat-value">${formatNum(totalPossible)}</div>
          <div class="stat-label">Total Possible Marks</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
          </svg>
        </div>
        <div class="stat-content">
          <div class="stat-value" style="color: var(--primary);">${percentage}%</div>
          <div class="stat-label">Semester Accuracy</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
        </div>
        <div class="stat-content">
          <div class="stat-value">${attemptedCount} / ${allQuizzes.length}</div>
          <div class="stat-label">Quizzes Attempted</div>
        </div>
      </div>
    </div>

    <!-- Student Quizzes Breakdown Table -->
    <div class="card" style="padding: 1.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.75rem;">
        <h3 class="card-title" style="margin: 0;">Complete Quiz Record</h3>
        <span style="font-size: 0.85rem; color: var(--text-muted);">
          Click "Inspect Answers" to view full question prompts and selected options
        </span>
      </div>

      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Class #</th>
              <th>Topic / Quiz Title</th>
              <th>Date</th>
              <th>Status</th>
              <th>Score</th>
              <th>Percentage</th>
              <th>Submission Time</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${quizRows.map(row => {
              const q = row.quiz;
              const classNum = String(q.class_number).padStart(2, '0');
              const inspectBtn = row.isAttempted
                ? `<button class="btn btn-outline btn-sm" onclick="window.inspectStudentAttempt('${row.att.id}', '${escapeHtml(student.full_name)}')">Inspect Answers &rarr;</button>`
                : `<span style="color: var(--text-muted); font-size: 0.8rem;">Unattempted</span>`;

              return `
                <tr>
                  <td><span class="badge badge-primary">Class ${classNum}</span></td>
                  <td><strong style="color: var(--text-primary);">${escapeHtml(q.title)}</strong></td>
                  <td><span style="color: var(--text-muted); font-size: 0.9rem;">${q.scheduled_date}</span></td>
                  <td><span class="badge ${row.badgeClass}">${row.statusText}</span></td>
                  <td>
                    ${row.isAttempted ? `<strong style="color: var(--success);">${row.score} / ${row.total}</strong>` : '-'}
                  </td>
                  <td>
                    ${row.isAttempted ? `<span class="badge ${Number(row.percentage) >= 80 ? 'badge-published' : 'badge-warning'}">${row.percentage}%</span>` : '-'}
                  </td>
                  <td><span style="color: var(--text-secondary); font-size: 0.85rem;">${row.subTime}</span></td>
                  <td>${inspectBtn}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Opens modal allowing the teacher to inspect individual question answers for an attempt
 */
window.inspectStudentAttempt = async function(attemptId, studentName) {
  const supabase = getSupabase();
  const modal = document.getElementById('quiz-answer-inspector-modal');
  const title = document.getElementById('inspector-modal-title');
  const scoreBadge = document.getElementById('inspector-score-badge');
  const body = document.getElementById('inspector-modal-body');

  modal.classList.add('active');
  body.innerHTML = `
    <div style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
      <div class="empty-icon" style="margin: 0 auto 0.75rem;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>
      <div>Loading student attempt answers...</div>
    </div>
  `;

  try {
    // 1. Fetch attempt and quiz details
    const { data: att, error: attErr } = await supabase
      .from('quiz_attempts')
      .select('*, quizzes(*)')
      .eq('id', attemptId)
      .single();

    if (attErr) throw attErr;

    const q = att.quizzes;
    title.textContent = `${studentName} — Class ${String(q?.class_number || 0).padStart(2, '0')}: ${q?.title || 'Quiz'}`;
    scoreBadge.textContent = `Score: ${att.score} / ${att.total_marks}`;

    // 2. Fetch questions and student answers
    const [answersRes, questionsRes] = await Promise.all([
      supabase.from('attempt_answers').select('*').eq('attempt_id', attemptId),
      supabase.from('questions').select('*').eq('quiz_id', att.quiz_id).order('order_index', { ascending: true })
    ]);

    const answers = answersRes.data || [];
    const questions = questionsRes.data || [];
    const answerMap = new Map(answers.map(a => [a.question_id, a]));

    body.innerHTML = questions.map((question, idx) => {
      const userAns = answerMap.get(question.id);
      const isCorrect = userAns ? Boolean(userAns.is_correct) : false;
      const awarded = userAns ? Number(userAns.marks_awarded || 0) : 0;
      const possible = Number(question.marks || 1.0);
      const selectedId = userAns ? (userAns.selected_option || 'None (Skipped)') : 'None';

      const options = question.options || [];
      const selectedObj = options.find(o => o.id === selectedId);
      const selectedText = selectedObj ? selectedObj.text : '';

      const correctId = question.correct_option || 'A';
      const correctObj = options.find(o => o.id === correctId);
      const correctText = correctObj ? correctObj.text : '';

      const statusColor = isCorrect ? 'var(--success)' : 'var(--danger)';
      const statusIcon = isCorrect 
        ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px;"><polyline points="20 6 9 17 4 12"/></svg>`
        : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

      return `
        <div class="card" style="margin-bottom: 1.25rem; background: var(--bg-card); border-left: 4px solid ${statusColor};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-muted); text-transform: uppercase;">
              Question ${idx + 1}
            </span>
            <span style="font-weight: 700; font-size: 0.9rem; color: ${statusColor}; display: inline-flex; align-items: center; gap: 0.35rem;">
              ${statusIcon} ${isCorrect ? 'Correct' : 'Incorrect'} (${awarded} / ${possible} pt)
            </span>
          </div>

          <div style="font-size: 1.05rem; font-weight: 600; margin-bottom: 0.75rem; color: var(--text-primary); line-height: 1.4;">
            ${escapeHtml(question.question_text)}
          </div>

          <div style="background: #f8fafc; padding: 0.85rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-color); font-size: 0.92rem;">
            <div>
              <span style="color: var(--text-muted);">Student's Selected Answer:</span>
              <strong style="color: ${statusColor}; margin-left: 0.35rem;">
                Option ${selectedId}${selectedText ? `: ${escapeHtml(selectedText)}` : ''}
              </strong>
            </div>

            <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px dashed var(--border-color); color: var(--success);">
              <strong>Correct Key:</strong> Option ${correctId}${correctText ? `: ${escapeHtml(correctText)}` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Error loading attempt answers:', err);
    body.innerHTML = `<div class="alert alert-danger">Failed to load attempt details: ${err.message}</div>`;
  }
};

function closeAnswerModal() {
  document.getElementById('quiz-answer-inspector-modal')?.classList.remove('active');
}

/**
 * Export Complete 35-Class Semester Matrix as RFC 4180 CSV
 */
export function exportSemesterMatrixCSV() {
  try {
    showToast('Preparing complete semester matrix CSV...', 'info');

    const headers = ['Student ID', 'Student Name', 'Section', 'Email'];
    for (let c = 1; c <= 35; c++) {
      const q = quizByClass.get(c);
      const title = q ? `Class ${String(c).padStart(2, '0')} - ${escapeCsv(q.title)}` : `Class ${String(c).padStart(2, '0')}`;
      headers.push(title);
    }
    headers.push('Total Earned Marks', 'Total Possible Marks', 'Semester Percentage (%)');

    const rows = [headers.join(',')];

    allStudents.forEach(student => {
      let earned = 0;
      let possible = 0;

      const row = [
        escapeCsv(student.student_id || 'N/A'),
        escapeCsv(student.full_name || 'N/A'),
        escapeCsv(student.section || 'A'),
        escapeCsv(student.email || 'N/A')
      ];

      for (let c = 1; c <= 35; c++) {
        const q = quizByClass.get(c);
        if (q) {
          const att = attemptByStudentQuiz.get(`${student.id}_${q.id}`);
          if (att) {
            const sc = Number(att.score || 0);
            const tot = Number(att.total_marks || 0);
            earned += sc;
            possible += tot;
            row.push(sc.toFixed(1));
          } else {
            row.push('0.0'); // Unattempted
          }
        } else {
          row.push('0.0'); // Unscheduled class
        }
      }

      const pct = possible > 0 ? ((earned / possible) * 100).toFixed(2) : '0.00';
      row.push(earned.toFixed(1));
      row.push(possible.toFixed(1));
      row.push(`${pct}%`);

      rows.push(row.join(','));
    });

    const dateStr = new Date().toISOString().split('T')[0];
    downloadCsvBlob(rows.join('\r\n'), `Full_Semester_Matrix_Gradebook_${dateStr}.csv`);
    showToast('Semester Matrix CSV downloaded successfully!', 'success');

  } catch (err) {
    console.error('CSV export error:', err);
    showToast('Failed to export matrix CSV: ' + err.message, 'danger');
  }
}

/**
 * Export Currently Filtered Matrix as CSV
 */
export function exportFilteredMatrixCSV() {
  try {
    const filtered = getFilteredStudents();
    if (filtered.length === 0) {
      showToast('No filtered students to export.', 'warning');
      return;
    }

    const headers = ['Student ID', 'Student Name', 'Section', 'Email'];
    for (let c = 1; c <= 35; c++) {
      headers.push(`Class ${String(c).padStart(2, '0')}`);
    }
    headers.push('Total Earned', 'Total Possible', 'Percentage');

    const rows = [headers.join(',')];

    filtered.forEach(student => {
      let earned = 0;
      let possible = 0;

      const row = [
        escapeCsv(student.student_id || 'N/A'),
        escapeCsv(student.full_name || 'N/A'),
        escapeCsv(student.section || 'A'),
        escapeCsv(student.email || 'N/A')
      ];

      for (let c = 1; c <= 35; c++) {
        const q = quizByClass.get(c);
        if (q) {
          const att = attemptByStudentQuiz.get(`${student.id}_${q.id}`);
          if (att) {
            const sc = Number(att.score || 0);
            earned += sc;
            possible += Number(att.total_marks || 0);
            row.push(sc.toFixed(1));
          } else {
            row.push('0.0');
          }
        } else {
          row.push('0.0');
        }
      }

      const pct = possible > 0 ? ((earned / possible) * 100).toFixed(2) : '0.00';
      row.push(earned.toFixed(1));
      row.push(possible.toFixed(1));
      row.push(`${pct}%`);

      rows.push(row.join(','));
    });

    const dateStr = new Date().toISOString().split('T')[0];
    downloadCsvBlob(rows.join('\r\n'), `Filtered_Semester_Matrix_${dateStr}.csv`);
    showToast('Filtered Matrix CSV downloaded!', 'success');

  } catch (err) {
    showToast('Export failed: ' + err.message, 'danger');
  }
}

/**
 * Export Individual Student Performance Report as CSV
 */
window.exportCurrentStudentCSV = function() {
  if (!currentSelectedStudentId) return;
  const student = allStudents.find(s => s.id === currentSelectedStudentId);
  if (!student) return;

  const headers = ['Class #', 'Quiz Title', 'Scheduled Date', 'Status', 'Score', 'Total Marks', 'Accuracy (%)', 'Submission Time'];
  const rows = [headers.join(',')];

  allQuizzes.forEach(q => {
    const att = attemptByStudentQuiz.get(`${student.id}_${q.id}`);
    const isAttempted = Boolean(att);
    const sc = isAttempted ? Number(att.score || 0) : 0;
    const tot = isAttempted ? Number(att.total_marks || 0) : 0;
    const pct = tot > 0 ? ((sc / tot) * 100).toFixed(1) : '0.0';
    const subTime = isAttempted ? new Date(att.submitted_at).toLocaleString() : 'Unattempted';

    rows.push([
      `Class ${String(q.class_number).padStart(2, '0')}`,
      escapeCsv(q.title),
      escapeCsv(q.scheduled_date),
      isAttempted ? 'Completed' : 'Missed',
      sc.toFixed(1),
      tot.toFixed(1),
      `${pct}%`,
      escapeCsv(subTime)
    ].join(','));
  });

  const roll = (student.student_id || 'student').replace(/[^a-zA-Z0-9_-]/g, '_');
  downloadCsvBlob(rows.join('\r\n'), `Student_Report_${roll}.csv`);
  showToast(`Report downloaded for ${student.full_name}!`, 'success');
};

function escapeCsv(str) {
  if (str === null || str === undefined) return '""';
  const text = String(str).replace(/"/g, '""');
  return `"${text}"`;
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function downloadCsvBlob(csvContent, filename) {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
