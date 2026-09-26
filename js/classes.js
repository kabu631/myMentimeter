/**
 * ==============================================================================
 * js/classes.js - Classes (program + semester + section) and the class picker
 * ==============================================================================
 * A class is a group of students such as "BBA · 1st Semester". Every subject
 * belongs to one class; every student belongs to one class and automatically
 * takes all of its subjects (see sql/setup.sql).
 */

import { getSupabase } from './supabase.js';
import { escapeHtml, classTitle, ordinal } from './utils.js';

/** <select> value meaning "add a class that isn't listed yet". */
export const NEW_CLASS = '__new__';

/** Active classes with their number of active subjects. Works signed out too (sign-up form). */
export async function fetchClasses() {
  const { data, error } = await getSupabase().rpc('list_classes');
  if (error) throw error;
  return data || [];
}

/** Find or create a class (teachers only) and return its id. */
export async function createClass({ program, semester, section }) {
  const { data, error } = await getSupabase().rpc('create_class', {
    p_program: program, p_semester: semester, p_section: section || null
  });
  if (error) throw error;
  return data;
}

function subjectCount(n) {
  return `${n} subject${n === 1 ? '' : 's'}`;
}

/**
 * <option> list for a class <select>.
 * withCounts: append "— 5 subjects"; allowNew: add "+ Add a new class".
 */
export function classOptionsHtml(classes, { selected = '', placeholder = 'Choose a class…', withCounts = false, allowNew = false } = {}) {
  const options = classes.map(c => {
    const label = classTitle(c) + (withCounts ? ` — ${subjectCount(c.subject_count)}` : '');
    return `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  });
  return [
    `<option value="" ${selected ? '' : 'selected'} disabled>${escapeHtml(placeholder)}</option>`,
    ...options,
    allowNew ? `<option value="${NEW_CLASS}" ${selected === NEW_CLASS ? 'selected' : ''}>+ Add a new class</option>` : ''
  ].join('');
}

export function semesterOptionsHtml(selected = 1) {
  return Array.from({ length: 12 }, (_, i) => i + 1)
    .map(n => `<option value="${n}" ${n === Number(selected) ? 'selected' : ''}>${ordinal(n)} Semester</option>`)
    .join('');
}

/**
 * Class <select> plus the "new class" fields (program, semester, section).
 * Element ids: `${prefix}-class`, `${prefix}-program`, `${prefix}-semester`, `${prefix}-section`.
 * With no classes yet, the new-class fields are shown straight away.
 */
export function classPickerHtml(prefix, classes, { selected = '', label = 'Class', hint = '' } = {}) {
  const initial = classes.length === 0 ? NEW_CLASS : selected;
  return `
    <div class="form-group">
      <label class="form-label" for="${prefix}-class">${escapeHtml(label)}</label>
      <select id="${prefix}-class" class="form-select">
        ${classOptionsHtml(classes, { selected: initial, withCounts: true, allowNew: true })}
      </select>
      ${hint ? `<span class="input-hint">${escapeHtml(hint)}</span>` : ''}
    </div>
    <div id="${prefix}-new-class" class="new-class-fields ${initial === NEW_CLASS ? '' : 'hidden'}">
      <div class="form-row form-row-3">
        <div class="form-group">
          <label class="form-label" for="${prefix}-program">Program</label>
          <input id="${prefix}-program" class="form-control" placeholder="e.g. BBA" maxlength="40" autocomplete="off">
        </div>
        <div class="form-group">
          <label class="form-label" for="${prefix}-semester">Semester</label>
          <select id="${prefix}-semester" class="form-select">${semesterOptionsHtml(1)}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="${prefix}-section">Section <span class="muted">(optional)</span></label>
          <input id="${prefix}-section" class="form-control" placeholder="e.g. A" maxlength="30" autocomplete="off">
        </div>
      </div>
    </div>`;
}

/** Show the new-class fields only while "+ Add a new class" is selected. */
export function bindClassPicker(root, prefix) {
  const select = root.querySelector(`#${prefix}-class`);
  const box = root.querySelector(`#${prefix}-new-class`);
  select.addEventListener('change', () => {
    const isNew = select.value === NEW_CLASS;
    box.classList.toggle('hidden', !isNew);
    if (isNew) root.querySelector(`#${prefix}-program`).focus();
  });
}

/**
 * Read a class picker. Returns { classId } for a listed class,
 * { program, semester, section } for a new one, or { error, field } when incomplete.
 */
export function readClassPicker(root, prefix) {
  const value = root.querySelector(`#${prefix}-class`).value;
  if (!value) return { error: 'Choose the class.', field: `${prefix}-class` };
  if (value !== NEW_CLASS) return { classId: value };

  const program = root.querySelector(`#${prefix}-program`).value.trim().replace(/\s+/g, ' ');
  if (!program) return { error: 'Enter the program name, such as BBA.', field: `${prefix}-program` };
  return {
    program,
    semester: Number(root.querySelector(`#${prefix}-semester`).value),
    section: root.querySelector(`#${prefix}-section`).value.trim().replace(/\s+/g, ' ') || null
  };
}

/** Same class? Compares ids, or program/semester/section case-insensitively for new classes. */
export function sameClass(a, b) {
  if (a.classId || b.classId) return a.classId === b.classId;
  const norm = (s) => (s || '').trim().toUpperCase();
  return norm(a.program) === norm(b.program) && Number(a.semester) === Number(b.semester) && norm(a.section) === norm(b.section);
}
