# DailyClassQuiz

A free quiz portal for the end of every class. Teachers publish a short multiple-choice quiz when the lecture
finishes, students answer on their phone and see their score straight away, and each student's semester marks
add up automatically for every course they take.

**Live site:** https://kabu631.github.io/myMentimeter/

It's plain HTML, CSS and JavaScript hosted on **GitHub Pages**, with **Supabase** (PostgreSQL + Auth) as the
database. Both are free.

---

## What it does

**Students**
- Register once (name, roll number, section), then join each course with the code their teacher shares.
- See every open quiz from all their courses on one dashboard. One attempt per quiz, with an optional timer.
- Get their score as soon as they submit. They can review correct answers once the teacher closes the quiz.
- Open their **Profile** for a semester report card: every quiz in each course, the total, the percentage,
  and final marks scaled to the teacher's weight (for example 8.5 / 10). The report can be printed or saved as a PDF.

**Teachers**
- Run any number of courses and sections. Each course has its own join code, roster and gradebook.
- Write quizzes with 2–6 options per question or True/False, marks per question, a time limit, and an
  automatic close time.
- **Gradebook:** one row per student, one column per quiz, with totals, percentages and weighted final
  marks. Open a student to see every answer or to allow a retake. Export the gradebook or a single student's
  report as CSV.
- Teachers see only their own courses and students. An **admin** account can see all of them.

**How semester marks are counted.** A quiz counts once the student has taken it or once it has closed. A
missed closed quiz scores 0 out of its full marks. Open quizzes a student hasn't taken yet don't count until
they close. If a course has a *quiz marks in final grade* weight (such as 10), the percentage is scaled to it.

---

## Setup

### 1. Supabase project
1. Create a free project at [supabase.com](https://supabase.com). Or open your existing one; if it says
   **Paused**, click **Restore**. Free projects pause after about a week with no activity.
2. Go to **Project Settings → API** and copy the **Project URL** and the **anon / public** key into
   [js/config.js](js/config.js). The anon key is safe to publish. Never put the `service_role` key in this repo.

### 2. Create the database
Open **SQL Editor → New query**, paste the whole of [sql/setup.sql](sql/setup.sql) and click **Run**.

- The last result row is your **faculty sign-up code**. Share it only with teachers, because anyone who has
  it can register a teacher account. To change it:
  `UPDATE public.app_settings SET value = 'NEW-CODE' WHERE key = 'faculty_signup_code';`
- The script can safely run again. If you used the older single-course version, it moves your existing
  quizzes into a course called **CS-301** owned by your teacher account and enrolls every existing
  student in it.
- [sql/hotfix_security_advisor.sql](sql/hotfix_security_advisor.sql) is only a stopgap for a database
  still on the old single-course schema. `setup.sql` already includes the same fixes, and it's fine to run
  after the hotfix.

### 3. Auth settings (Supabase → Authentication)
- **URL Configuration:** set **Site URL** to `https://kabu631.github.io/myMentimeter/` and add
  `https://kabu631.github.io/myMentimeter/**` under **Redirect URLs**. Add `http://localhost:8080/**` too
  if you test locally.
- **Sign In / Providers → Email:** turning **Confirm email** *off* is recommended for a classroom.
  Supabase's built-in email service sends only a few emails per hour, so 60 students registering at once
  would get stuck. Leave it on only if you set up your own SMTP server.

### 4. Publish on GitHub Pages
1. GitHub Pages on a free account needs a **public** repository (**Settings → General → Change visibility**).
2. Go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then **main** and
   **/ (root)**, and click **Save**.
3. After a minute or two the site is live at `https://kabu631.github.io/myMentimeter/`.

### 5. First accounts
- **Teachers:** open the site → **Create account** → **I'm a Teacher** → enter the faculty code.
- **Admin (optional):** register, then run [sql/make_admin.sql](sql/make_admin.sql) with your email.
- **Students:** share the course **join code**. The Students page has a *Copy invite message* button.

---

## Day-to-day use

1. **After class:** Quizzes → **+ New Quiz** → write the questions → **Publish now**. You can set an
   automatic close time, for example "+30 min".
2. Students take it from their dashboard and see their score.
3. **Close** the quiz (or let the automatic close time pass). Students can then review the correct
   answers, if you allowed it.
4. **End of semester:** Gradebook → **Export gradebook (CSV)**.

A student forgot their password right before a quiz? Run [sql/reset_student_password.sql](sql/reset_student_password.sql)
to set a temporary one immediately.

---

## Security

- Grading runs inside PostgreSQL (`submit_quiz`). Students read questions through a view with no
  answer-key column, so the key never reaches their browser.
- Row Level Security isolates each teacher's data and each student's attempts. Students can't insert or edit
  attempts, change their score, or change their role, roll number or email.
- Correct answers are revealed only after a quiz closes, so students can't pass them on while others are
  still taking it.
- Privileged functions live in a `private` schema that the Supabase API doesn't expose. The app calls
  thin `public` wrappers.
- All user-provided text is HTML-escaped, and CSV exports are protected against spreadsheet formula injection.

---

## Project structure

```
index.html            Landing page (signed-in users go straight to their home)
login.html            Sign in + forgot password
register.html         Student / teacher registration
reset-password.html   Set a new password from the email link
dashboard.html        Student: open quizzes, courses, join by code, recent results
quiz.html             Student: take a quiz (timer, auto-save, keyboard shortcuts)
results.html          Student: all attempts + answer review
profile.html          Student: semester report card, edit profile, change password
admin/index.html      Teacher: courses, join codes, open quizzes
admin/quizzes.html    Teacher: quiz list per course (publish / close / reopen / delete)
admin/create-quiz.html Teacher: quiz editor
admin/students.html   Teacher: roster, invite message, remove students
admin/results.html    Teacher: semester gradebook, student reports, CSV export
js/                   One module per page plus shared auth, utils, student-data, review, admin-service
css/                  Design tokens (main), components, quiz, admin, auth
sql/setup.sql         Complete database: tables, RLS, RPCs (run this)
sql/make_admin.sql    Change an account's role
sql/reset_student_password.sql  Set a temporary password
```

## Run locally

```
npm start      # serves the site at http://localhost:8080 (needs Node.js)
```
