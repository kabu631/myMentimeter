/**
 * export-csv.js - Browser-Side Gradebook CSV Matrix Generator
 * Generates an RFC 4180 compliant CSV file without any server dependencies.
 */

import { getSupabase, showToast } from './supabase.js';

export async function exportGradebookCSV() {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    showToast('Compiling semester gradebook matrix...', 'info');

    // 1. Fetch all students
    const { data: students, error: sErr } = await supabase
      .from('profiles')
      .select('id, student_id, full_name, email')
      .eq('role', 'student')
      .order('student_id', { ascending: true });

    if (sErr) throw sErr;

    if (!students || students.length === 0) {
      showToast('No registered students found to export.', 'warning');
      return;
    }

    // 2. Fetch all quizzes
    const { data: quizzes, error: qErr } = await supabase
      .from('quizzes')
      .select('id, class_number, title')
      .order('class_number', { ascending: true });

    if (qErr) throw qErr;

    // 3. Fetch all attempts
    const { data: attempts, error: aErr } = await supabase
      .from('quiz_attempts')
      .select('student_id, quiz_id, score, total_marks');

    if (aErr) throw aErr;

    // Build lookup map: `${student_id}_${quiz_id}` -> attempt
    const attemptMap = new Map();
    attempts?.forEach(a => {
      attemptMap.set(`${a.student_id}_${a.quiz_id}`, a);
    });

    // 4. Build CSV Header
    const headers = ['Roll Number', 'Full Name', 'College Email'];
    quizzes?.forEach(q => {
      headers.push(`Class ${String(q.class_number).padStart(2, '0')} (${escapeCsv(q.title)})`);
    });
    headers.push('Cumulative Score', 'Total Possible', 'Semester Accuracy (%)');

    const rows = [headers.join(',')];

    // 5. Build CSV Data Rows
    students.forEach(student => {
      let studentCumulativeScore = 0;
      let studentTotalPossible = 0;

      const row = [
        escapeCsv(student.student_id || 'N/A'),
        escapeCsv(student.full_name || 'N/A'),
        escapeCsv(student.email || 'N/A')
      ];

      quizzes?.forEach(q => {
        const key = `${student.id}_${q.id}`;
        const att = attemptMap.get(key);

        if (att) {
          const score = Number(att.score || 0);
          const total = Number(att.total_marks || 0);
          studentCumulativeScore += score;
          studentTotalPossible += total;
          row.push(score.toFixed(1));
        } else {
          row.push('0.0'); // Unattempted
        }
      });

      const pct = studentTotalPossible > 0 
        ? ((studentCumulativeScore / studentTotalPossible) * 100).toFixed(1)
        : '0.0';

      row.push(studentCumulativeScore.toFixed(1));
      row.push(studentTotalPossible.toFixed(1));
      row.push(`${pct}%`);

      rows.push(row.join(','));
    });

    // 6. Generate Blob and Trigger Download
    const csvContent = '\uFEFF' + rows.join('\r\n'); // Add UTF-8 BOM for Excel compatibility
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];

    link.setAttribute('href', url);
    link.setAttribute('download', `CS301_Daily_Quiz_Gradebook_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('CSV Gradebook downloaded successfully!', 'success');

  } catch (err) {
    console.error('Error generating CSV:', err);
    showToast('Failed to export CSV: ' + err.message, 'danger');
  }
}

function escapeCsv(str) {
  if (str === null || str === undefined) return '""';
  const text = String(str).replace(/"/g, '""');
  return `"${text}"`;
}
