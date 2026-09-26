/**
 * ==============================================================================
 * js/admin-accounts.js - Administrator: every teacher and student account
 * ==============================================================================
 * Only for role 'admin'. Lists accounts (with last sign-in and blocked status),
 * edits name / roll number / role / class, resets passwords, blocks or deletes
 * accounts, hands a teacher's subjects to another teacher, creates accounts,
 * and shows or renews the faculty sign-up code. The database re-checks the
 * admin role in every call (sql/setup.sql, section 7h).
 */

import { getSupabase, showToast, createDetachedClient } from './supabase.js';
import { updateUserPassword } from './auth.js';
import { guardAdminPage } from './admin-service.js';
import { fetchClasses } from './classes.js';
import {
  escapeHtml, fmtDateTime, classTitle, setBusy, friendlyError, showFieldError, clearFieldErrors, copyText, emptyState
} from './utils.js';

const $ = (id) => document.getElementById(id);
const ROLE_LABEL = { student: 'Student', teacher: 'Teacher', admin: 'Admin' };
const ROLE_BADGE = { student: 'badge-published', teacher: 'badge-primary', admin: 'badge-accent' };

let me = null;
let accounts = [];
let classes = [];
let facultyCode = '';
let codeVisible = false;
let roleFilter = 'all';
let editing = null;
let resetting = null;

async function initAccounts() {
  me = await guardAdminPage();
  if (!me) return;
  if (me.role !== 'admin') {
    window.location.replace('index.html');
    return;
  }

  document.querySelectorAll('[data-role]').forEach(btn => btn.addEventListener('click', () => {
    roleFilter = btn.dataset.role;
    document.querySelectorAll('[data-role]').forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', String(b === btn));
    });
    renderTable();
  }));
  $('filter-class').addEventListener('change', renderTable);
  $('filter-search').addEventListener('input', renderTable);
  $('btn-copy-code').addEventListener('click', copyCode);
  $('faculty-code').addEventListener('click', () => { codeVisible = !codeVisible; renderCode(); });
  $('btn-new-code').addEventListener('click', newCode);
  $('form-my-password').addEventListener('submit', changeMyPassword);
  $('btn-add-account').addEventListener('click', openAddModal);
  setupModals();

  await loadAll();
}

async function loadAll() {
  const supabase = getSupabase();
  try {
    const [list, classList, code] = await Promise.all([
      supabase.rpc('admin_list_accounts'),
      fetchClasses(),
      supabase.rpc('admin_get_faculty_code')
    ]);
    if (list.error) throw list.error;
    if (code.error) throw code.error;
    accounts = list.data || [];
    classes = classList;
    facultyCode = code.data || '';
  } catch (err) {
    showToast('Could not load accounts: ' + friendlyError(err), 'danger');
    return;
  }
  renderCode();
  renderStats();
  renderClassFilter();
  renderTable();
}

// ------------------------------------------------------------------------------
// Faculty code, stats, filters
// ------------------------------------------------------------------------------

function renderCode() {
  const el = $('faculty-code');
  el.textContent = codeVisible ? facultyCode : facultyCode.replace(/[A-Z0-9]/g, '•');
  el.title = codeVisible ? 'Click to hide' : 'Click to show';
}

async function copyCode() {
  if (await copyText(facultyCode)) showToast('Faculty code copied.', 'success');
}

async function newCode() {
  if (!confirm('Generate a new faculty sign-up code? The current code will stop working for new teacher sign-ups.')) return;
  const { data, error } = await getSupabase().rpc('admin_new_faculty_code');
  if (error) {
    showToast(friendlyError(error), 'danger');
    return;
  }
  facultyCode = data;
  codeVisible = true;
  renderCode();
  showToast(`New faculty code: ${data}`, 'success');
}

function renderStats() {
  $('stat-teachers').textContent = accounts.filter(a => a.role === 'teacher').length;
  $('stat-students').textContent = accounts.filter(a => a.role === 'student').length;
  $('stat-classes').textContent = classes.length;
  $('stat-blocked').textContent = accounts.filter(a => a.is_blocked).length;
}

function classById(id) {
  return classes.find(c => c.id === id) || null;
}

function renderClassFilter() {
  const select = $('filter-class');
  const current = select.value;
  select.innerHTML = '<option value="">All classes</option><option value="none">No class</option>' +
    classes.map(c => `<option value="${c.id}">${escapeHtml(classTitle(c))}</option>`).join('');
  select.value = [...select.options].some(o => o.value === current) ? current : '';
}

function filteredAccounts() {
  const term = $('filter-search').value.trim().toLowerCase();
  const cls = $('filter-class').value;
  return accounts.filter(a => {
    if (roleFilter !== 'all' && a.role !== roleFilter) return false;
    if (cls === 'none' && (a.role !== 'student' || a.class_id)) return false;
    if (cls && cls !== 'none' && a.class_id !== cls) return false;
    if (!term) return true;
    return [a.full_name, a.email, a.student_id].some(v => (v || '').toLowerCase().includes(term));
  });
}

// ------------------------------------------------------------------------------
// Table
// ------------------------------------------------------------------------------

function renderTable() {
  const tbody = $('accounts-body');
  const list = filteredAccounts();
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">${accounts.length === 0
      ? emptyState('users', 'No accounts yet', 'Teachers and students appear here as soon as they register.')
      : emptyState('search', 'No accounts match', 'Try another filter or search.')}</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(a => {
    const self = a.id === me.id;
    const cls = classById(a.class_id);
    const detail = a.role === 'student'
      ? (cls ? escapeHtml(classTitle(cls)) : '<span class="muted">No class</span>')
      : `${a.subject_count} subject${a.subject_count === 1 ? '' : 's'}`;
    return `
      <tr class="${a.is_blocked ? 'row-blocked' : ''}">
        <td>
          <strong class="strong">${escapeHtml(a.full_name)}</strong>${self ? ' <span class="small muted">(you)</span>' : ''}
          <div class="small muted">${escapeHtml(a.email)}</div>
        </td>
        <td><span class="badge ${ROLE_BADGE[a.role]}">${ROLE_LABEL[a.role]}</span></td>
        <td class="mono small">${escapeHtml(a.student_id || '—')}</td>
        <td class="small">${detail}</td>
        <td class="small nowrap">${a.last_sign_in_at ? fmtDateTime(a.last_sign_in_at) : '<span class="muted">Never</span>'}</td>
        <td>${a.is_blocked ? '<span class="badge badge-closed">Blocked</span>' : '<span class="badge badge-published">Active</span>'}</td>
        <td class="nowrap">
          <button type="button" class="btn btn-secondary btn-sm" data-edit="${a.id}">Edit</button>
          <button type="button" class="btn btn-outline btn-sm" data-password="${a.id}">Password</button>
          ${self ? '' : `
            <button type="button" class="btn btn-outline btn-sm" data-block="${a.id}">${a.is_blocked ? 'Unblock' : 'Block'}</button>
            <button type="button" class="btn btn-danger-outline btn-sm" data-delete="${a.id}">Delete</button>`}
        </td>
      </tr>`;
  }).join('');

  const byId = (id) => accounts.find(a => a.id === id);
  tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditModal(byId(b.dataset.edit))));
  tbody.querySelectorAll('[data-password]').forEach(b => b.addEventListener('click', () => openPasswordModal(byId(b.dataset.password))));
  tbody.querySelectorAll('[data-block]').forEach(b => b.addEventListener('click', () => toggleBlock(byId(b.dataset.block))));
  tbody.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => deleteAccount(byId(b.dataset.delete))));
}

// ------------------------------------------------------------------------------
// Modals
// ------------------------------------------------------------------------------

function setupModals() {
  ['edit-modal', 'password-modal', 'add-modal'].forEach(id => {
    const modal = $(id);
    modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => modal.classList.remove('active')));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
  });
  $('edit-role').addEventListener('change', syncEditFields);
  $('edit-form').addEventListener('submit', saveEdit);
  $('btn-transfer').addEventListener('click', transferSubjects);
  $('btn-generate-password').addEventListener('click', () => { $('reset-password').value = randomPassword(); });
  $('password-form').addEventListener('submit', setPassword);
  $('add-role').addEventListener('change', syncAddFields);
  $('btn-generate-add').addEventListener('click', () => { $('add-password').value = randomPassword(); });
  $('add-form').addEventListener('submit', createAccount);
}

function classSelectHtml(selected) {
  return '<option value="">No class</option>' +
    classes.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${escapeHtml(classTitle(c))}</option>`).join('');
}

/** Easy to read out loud: no 0/O, 1/l/I. */
function randomPassword() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

function signInDetailsHtml(name, email, password) {
  return `
    <strong>Give ${escapeHtml(name)} these sign-in details:</strong>
    <div class="mono" style="margin: 0.4rem 0;">Email: ${escapeHtml(email)}<br>Password: ${escapeHtml(password)}</div>
    <button type="button" class="btn btn-outline btn-sm" data-copy-details>Copy details</button>`;
}

function bindCopyDetails(container, email, password) {
  container.querySelector('[data-copy-details]').addEventListener('click', async () => {
    const text = `Quizora sign-in\nWebsite: ${new URL('../login.html', window.location.href).href}\nEmail: ${email}\nPassword: ${password}`;
    if (await copyText(text)) showToast('Sign-in details copied.', 'success');
  });
}

// ---- Edit

function openEditModal(account) {
  editing = account;
  const form = $('edit-form');
  clearFieldErrors(form);
  const self = account.id === me.id;
  $('edit-modal-title').textContent = `Edit ${account.full_name}`;
  $('edit-email').textContent = `Sign-in email: ${account.email}`;
  $('edit-name').value = account.full_name;
  $('edit-role').value = account.role;
  $('edit-role').disabled = self;   // never lock yourself out of admin
  $('edit-roll').value = account.student_id || '';
  $('edit-class').innerHTML = classSelectHtml(account.class_id);

  const transfer = $('edit-transfer');
  const others = accounts.filter(a => a.id !== account.id && (a.role === 'teacher' || a.role === 'admin'));
  transfer.classList.toggle('hidden', !(account.subject_count > 0));
  if (account.subject_count > 0) {
    $('edit-transfer-text').textContent = `${account.full_name} teaches ${account.subject_count} subject${account.subject_count === 1 ? '' : 's'}. ` +
      'Move them to another teacher (for example when a teacher leaves). Quizzes and student marks move with them.';
    $('edit-transfer-to').innerHTML = others.length
      ? others.map(a => `<option value="${a.id}">${escapeHtml(a.full_name)} (${ROLE_LABEL[a.role]})</option>`).join('')
      : '<option value="">No other teacher yet</option>';
    $('btn-transfer').disabled = others.length === 0;
  }

  syncEditFields();
  $('edit-modal').classList.add('active');
  $('edit-name').focus();
}

function syncEditFields() {
  $('edit-student-fields').classList.toggle('hidden', $('edit-role').value !== 'student');
}

async function saveEdit(e) {
  e.preventDefault();
  clearFieldErrors(e.target);
  const nameInput = $('edit-name');
  const name = nameInput.value.trim();
  const role = $('edit-role').value;
  if (name.length < 2) {
    showFieldError(nameInput, 'Enter the full name.');
    return;
  }
  if (role === 'student' && editing.subject_count > 0) {
    showFieldError($('edit-role'), 'Move this teacher\'s subjects to another teacher before making them a student.');
    return;
  }
  if (role !== editing.role && !confirm(`Change ${editing.full_name} from ${ROLE_LABEL[editing.role]} to ${ROLE_LABEL[role]}?`)) return;

  const patch = { full_name: name };
  if (editing.id !== me.id) patch.role = role;
  if (role === 'student') {
    patch.student_id = $('edit-roll').value.trim() || null;
    patch.class_id = $('edit-class').value || null;
  } else {
    patch.student_id = null;
    patch.class_id = null;
  }

  const btn = $('btn-save-edit');
  setBusy(btn, true);
  const { error } = await getSupabase().from('profiles').update(patch).eq('id', editing.id);
  setBusy(btn, false);
  if (error) {
    if (error.code === '23505') showFieldError($('edit-roll'), 'Another account already uses this roll number.');
    else showToast('Could not save: ' + friendlyError(error), 'danger');
    return;
  }
  $('edit-modal').classList.remove('active');
  showToast(`${name} saved.`, 'success');
  await loadAll();
}

async function transferSubjects() {
  const to = accounts.find(a => a.id === $('edit-transfer-to').value);
  if (!to) return;
  if (!confirm(`Move all of ${editing.full_name}'s subjects to ${to.full_name}? Their quizzes and student marks move too.`)) return;
  const btn = $('btn-transfer');
  setBusy(btn, true, 'Moving...');
  const { data, error } = await getSupabase().rpc('admin_transfer_subjects', { p_from: editing.id, p_to: to.id });
  setBusy(btn, false);
  if (error) {
    showToast(friendlyError(error), 'danger');
    return;
  }
  $('edit-modal').classList.remove('active');
  showToast(`Moved ${data} subject${data === 1 ? '' : 's'} to ${to.full_name}.`, 'success');
  await loadAll();
}

// ---- Password

function openPasswordModal(account) {
  resetting = account;
  clearFieldErrors($('password-form'));
  $('password-modal-title').textContent = account.id === me.id ? 'Reset my password' : `Reset password for ${account.full_name}`;
  $('password-for').textContent = `Sign-in email: ${account.email}`;
  $('reset-password').value = randomPassword();
  $('password-done').classList.add('hidden');
  $('btn-set-password').disabled = false;
  $('password-modal').classList.add('active');
  $('reset-password').focus();
}

async function setPassword(e) {
  e.preventDefault();
  clearFieldErrors(e.target);
  const input = $('reset-password');
  const password = input.value.trim();
  if (password.length < 6) {
    showFieldError(input, 'The password needs at least 6 characters.');
    return;
  }
  const btn = $('btn-set-password');
  setBusy(btn, true);
  const { error } = await getSupabase().rpc('admin_set_password', { p_user_id: resetting.id, p_password: password });
  setBusy(btn, false);
  if (error) {
    showToast('Could not set the password: ' + friendlyError(error), 'danger');
    return;
  }
  const done = $('password-done');
  done.innerHTML = signInDetailsHtml(resetting.full_name, resetting.email, password);
  bindCopyDetails(done, resetting.email, password);
  done.classList.remove('hidden');
  btn.disabled = true;
  showToast('Password changed.', 'success');
}

// ---- Block / delete

async function toggleBlock(account) {
  const block = !account.is_blocked;
  if (block && !confirm(`Block ${account.full_name}? They are signed out and can't sign in until you unblock them. Their data is kept.`)) return;
  const { error } = await getSupabase().rpc('admin_set_blocked', { p_user_id: account.id, p_blocked: block });
  if (error) {
    showToast(friendlyError(error), 'danger');
    return;
  }
  showToast(block ? `${account.full_name} is blocked.` : `${account.full_name} can sign in again.`, 'success');
  await loadAll();
}

async function deleteAccount(account) {
  if (account.subject_count > 0) {
    alert(`${account.full_name} still teaches ${account.subject_count} subject(s). Open Edit and move them to another teacher first, so no student marks are lost.`);
    return;
  }
  const marks = account.attempt_count > 0 ? ` Their ${account.attempt_count} quiz result(s) will be deleted too.` : '';
  if (!confirm(`Delete ${account.full_name} (${account.email}) permanently?${marks} This cannot be undone.\n\nTo stop them signing in but keep their data, use Block instead.`)) return;
  const { error } = await getSupabase().rpc('admin_delete_account', { p_user_id: account.id });
  if (error) {
    showToast(friendlyError(error), 'danger');
    return;
  }
  showToast(`${account.full_name} deleted.`, 'info');
  await loadAll();
}

// ---- Add account

function openAddModal() {
  const form = $('add-form');
  form.reset();
  clearFieldErrors(form);
  $('add-class').innerHTML = '<option value="" selected disabled>Choose a class…</option>' +
    classes.map(c => `<option value="${c.id}">${escapeHtml(classTitle(c))}</option>`).join('');
  $('add-password').value = randomPassword();
  $('add-done').classList.add('hidden');
  syncAddFields();
  $('add-modal').classList.add('active');
  $('add-role').focus();
}

function syncAddFields() {
  const student = $('add-role').value === 'student';
  $('add-student-fields').classList.toggle('hidden', !student);
  $('add-teacher-note').classList.toggle('hidden', student);
}

async function createAccount(e) {
  e.preventDefault();
  const form = e.target;
  clearFieldErrors(form);
  const role = $('add-role').value;
  const name = $('add-name').value.trim();
  const email = $('add-email').value.trim().toLowerCase();
  const roll = $('add-roll').value.trim();
  const classId = $('add-class').value;
  const password = $('add-password').value.trim();

  if (name.length < 2) return showFieldError($('add-name'), 'Enter the full name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showFieldError($('add-email'), 'Enter a valid email address.');
  if (role === 'student' && roll.length < 2) return showFieldError($('add-roll'), 'Enter the roll / registration number.');
  if (role === 'student' && !classId) return showFieldError($('add-class'), 'Choose the class.');
  if (password.length < 6) return showFieldError($('add-password'), 'The password needs at least 6 characters.');

  const btn = $('btn-create-account');
  setBusy(btn, true, 'Creating...');
  try {
    const supabase = getSupabase();
    if (role === 'student') {
      const { data: free, error } = await supabase.rpc('is_student_id_available', { p_student_id: roll });
      if (error) throw error;
      if (!free) {
        showFieldError($('add-roll'), 'Another account already uses this roll number.');
        return;
      }
    }

    const metadata = role === 'student'
      ? { account_type: 'student', full_name: name, student_id: roll, class_id: classId }
      : { account_type: 'teacher', full_name: name, faculty_code: facultyCode, subjects: [] };
    const { data, error } = await createDetachedClient().auth.signUp({ email, password, options: { data: metadata } });
    if (error) {
      if (/already registered|already exists/i.test(error.message || '')) {
        showFieldError($('add-email'), 'An account with this email already exists.');
        return;
      }
      throw error;
    }
    if (!data?.user || data.user.identities?.length === 0) {
      showFieldError($('add-email'), 'An account with this email already exists.');
      return;
    }
    if (role === 'admin') {
      const { error: promoteErr } = await supabase.from('profiles').update({ role: 'admin' }).eq('id', data.user.id);
      if (promoteErr) throw promoteErr;
    }

    const done = $('add-done');
    done.innerHTML = signInDetailsHtml(name, email, password) +
      (data.session ? '' : '<p class="small" style="margin: 0.5rem 0 0;">Email confirmation is switched on in Supabase, so they must click the link in their inbox first.</p>');
    bindCopyDetails(done, email, password);
    done.classList.remove('hidden');
    ['add-name', 'add-email', 'add-roll'].forEach(id => { $(id).value = ''; });
    $('add-password').value = randomPassword();
    showToast(`${ROLE_LABEL[role]} account created for ${name}.`, 'success');
    await loadAll();
  } catch (err) {
    showToast('Could not create the account: ' + friendlyError(err), 'danger');
  } finally {
    setBusy(btn, false);
  }
}

// ---- My password

async function changeMyPassword(e) {
  e.preventDefault();
  clearFieldErrors(e.target);
  const pwd = $('my-new-password');
  if (pwd.value.length < 6) return showFieldError(pwd, 'At least 6 characters.');
  if (pwd.value !== $('my-confirm-password').value) return showFieldError($('my-confirm-password'), 'The two passwords do not match.');
  const btn = $('btn-my-password');
  setBusy(btn, true, 'Updating...');
  const res = await updateUserPassword(pwd.value);
  setBusy(btn, false);
  if (!res.success) {
    showToast(res.error, 'danger');
    return;
  }
  e.target.reset();
  showToast('Your password is changed.', 'success');
}

document.addEventListener('DOMContentLoaded', initAccounts);
