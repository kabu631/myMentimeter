/**
 * ==============================================================================
 * js/utils.js - Shared helpers: escaping, formatting, quiz state, grading math, CSV
 * ==============================================================================
 */

/**
 * Absolute URL of a page at the site root. Works from both / and /admin/ pages
 * and under a GitHub Pages project path such as /myMentimeter/.
 */
export function rootUrl(path = '') {
  return new URL(`../${path}`, import.meta.url).href;
}

/** Escape any value for safe insertion into innerHTML. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ------------------------------------------------------------------------------
// Number & date formatting
// ------------------------------------------------------------------------------

/** 7 -> "7", 7.5 -> "7.5", 7.456 -> "7.46" */
export function fmtNum(value, digits = 2) {
  const n = Number(value || 0);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

export function fmtPct(value, digits = 1) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

export function percentOf(earned, possible) {
  return possible > 0 ? (earned / possible) * 100 : 0;
}

/** Badge class for a percentage: green >= 80, amber >= 50, red below. */
export function pctBadgeClass(pct) {
  if (pct >= 80) return 'badge-published';
  if (pct >= 50) return 'badge-warning';
  return 'badge-closed';
}

export function scorePillClass(pct) {
  if (pct >= 80) return 'score-high';
  if (pct >= 50) return 'score-mid';
  return 'score-low';
}

export function classLabel(n) {
  return `Class ${String(n ?? 0).padStart(2, '0')}`;
}

export function courseLabel(course) {
  if (!course) return 'Unknown course';
  return `${course.code} · ${course.name}${course.section ? ` (${course.section})` : ''}`;
}

/** Accepts 'YYYY-MM-DD' (treated as a local date) or a timestamp. */
export function fmtDate(value) {
  if (!value) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

/** Today's date as 'YYYY-MM-DD' in the viewer's timezone. */
export function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Timestamp -> value for <input type="datetime-local"> (local time). */
export function toLocalInput(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null;
}

// ------------------------------------------------------------------------------
// Quiz state (mirrors public.quiz_is_closed in sql/setup.sql)
// ------------------------------------------------------------------------------

export function isQuizClosed(quiz, now = Date.now()) {
  if (!quiz) return false;
  return quiz.status === 'closed' || Boolean(quiz.closes_at && new Date(quiz.closes_at).getTime() < now);
}

export function isQuizOpen(quiz) {
  return quiz?.status === 'published' && !isQuizClosed(quiz);
}

/** Students see their score right away, or once the quiz closes if the teacher chose that. */
export function isScoreVisible(quiz) {
  return Boolean(quiz?.show_score_immediately) || isQuizClosed(quiz);
}

export function quizStatusBadge(quiz) {
  if (quiz.status === 'draft') return '<span class="badge badge-draft">Draft</span>';
  if (isQuizClosed(quiz)) return '<span class="badge badge-closed">Closed</span>';
  return '<span class="badge badge-published">Open</span>';
}

// ------------------------------------------------------------------------------
// Semester grading
// ------------------------------------------------------------------------------

/**
 * Semester summary for one student in one course.
 *
 * A quiz counts toward the total once the student has attempted it or the quiz
 * has closed (a missed closed quiz scores 0 out of its full marks). Open quizzes
 * the student hasn't taken yet are "pending" and don't count yet. Drafts never count.
 *
 * @param {Array} quizzes            quizzes of the course (any order)
 * @param {Map}   attemptsByQuizId   quiz_id -> attempt for this student
 * @param {number|null} finalWeight  course.final_weight (marks the quiz component is worth)
 */
export function summarizeCourse(quizzes, attemptsByQuizId, finalWeight = null) {
  const rows = [];
  let earned = 0;
  let possible = 0;
  let attempted = 0;
  let counted = 0;

  const ordered = [...quizzes].sort((a, b) => a.class_number - b.class_number);
  for (const quiz of ordered) {
    if (quiz.status === 'draft') continue;
    const attempt = attemptsByQuizId.get(quiz.id) || null;
    let state;
    if (attempt) {
      state = 'attempted';
      earned += Number(attempt.score || 0);
      possible += Number(attempt.total_marks || 0);
      attempted += 1;
      counted += 1;
    } else if (isQuizClosed(quiz)) {
      state = 'missed';
      possible += Number(quiz.total_marks || 0);
      counted += 1;
    } else {
      state = 'pending';
    }
    rows.push({ quiz, attempt, state });
  }

  const percentage = percentOf(earned, possible);
  const weighted = finalWeight ? (percentage / 100) * Number(finalWeight) : null;
  return { rows, earned, possible, percentage, attempted, counted, weighted };
}

// ------------------------------------------------------------------------------
// CSV export (RFC 4180, formula-injection safe)
// ------------------------------------------------------------------------------

function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  let text = String(value);
  // Stop spreadsheet apps from treating user-provided text as a formula
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(rows, filename) {
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function safeFilename(text) {
  return String(text || 'export').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

// ------------------------------------------------------------------------------
// Small UI helpers
// ------------------------------------------------------------------------------

/** Human-readable message for Supabase / network errors. */
export function friendlyError(err) {
  const msg = (err && (err.message || err.error_description)) || String(err || 'Something went wrong.');
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(msg)) {
    return 'Cannot reach the server. Check your internet connection — if it keeps happening, the Supabase project may be paused.';
  }
  // Missing table/function: the database hasn't been upgraded with sql/setup.sql yet
  if (err?.code === 'PGRST202' || err?.code === 'PGRST205' || /in the schema cache/i.test(msg)) {
    return 'The database is not set up for this version of the app yet. Ask your administrator to run sql/setup.sql in Supabase.';
  }
  return msg;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/**
 * Inline form errors (shown under the field, linked via aria-describedby).
 * showFieldError(input, message) marks the field invalid and focuses it;
 * clearFieldErrors(form) resets every field in the form.
 */
export function showFieldError(input, message) {
  if (!input) return;
  const id = `${input.id}-error`;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('span');
    el.id = id;
    el.className = 'field-error';
    el.setAttribute('role', 'alert');
    input.insertAdjacentElement('afterend', el);
  }
  el.textContent = message;
  input.setAttribute('aria-invalid', 'true');
  const described = new Set((input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
  described.add(id);
  input.setAttribute('aria-describedby', [...described].join(' '));
  input.focus();
  input.addEventListener('input', () => clearFieldError(input), { once: true });
}

export function clearFieldError(input) {
  const el = document.getElementById(`${input.id}-error`);
  if (el) el.remove();
  input.removeAttribute('aria-invalid');
  const rest = (input.getAttribute('aria-describedby') || '').split(' ').filter(t => t && t !== `${input.id}-error`);
  if (rest.length) input.setAttribute('aria-describedby', rest.join(' '));
  else input.removeAttribute('aria-describedby');
}

export function clearFieldErrors(form) {
  form.querySelectorAll('[aria-invalid="true"]').forEach(clearFieldError);
}

/** Disable a button and swap its label while an async action runs. */
export function setBusy(button, busy, busyLabel = 'Saving...') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.textContent = busyLabel;
  } else {
    button.disabled = false;
    if (button.dataset.label) button.innerHTML = button.dataset.label;
  }
}

export const ICONS = {
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  arrowUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>',
  arrowDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
  duplicate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>'
};

/** Standard empty-state block. `icon` is a key of ICONS. */
export function emptyState(icon, title, text, actionHtml = '') {
  return `
    <div class="empty-state">
      <div class="empty-icon">${ICONS[icon] || ICONS.book}</div>
      <div class="empty-title">${escapeHtml(title)}</div>
      <p class="empty-text">${escapeHtml(text)}</p>
      ${actionHtml}
    </div>
  `;
}
