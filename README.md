# Quizora

A free quiz portal for the end of every class. Teachers publish a short multiple-choice quiz when the lecture
finishes, students answer on their phone and see their score straight away, and each student's semester marks
add up automatically for every subject they take.

**Live site:** https://kabu631.github.io/myMentimeter/

It's plain HTML, CSS and JavaScript hosted on **GitHub Pages**, with **Supabase** (PostgreSQL + Auth) as the
database. Both are free.

---

## How the college is organised

- A **class** is a program and semester, with an optional section: *BBA · 1st Semester*, *BBA · 5th Semester*.
- A **subject** belongs to one class and has one teacher. A class usually has about five subjects taught by
  five teachers. One teacher can teach several subjects in several classes.
- A **student** belongs to exactly one class and is enrolled in **every subject of that class automatically**,
  including subjects a teacher adds later.

For example, Ram studies in *BBA · 1st Semester*, where Hari teaches Computer Applications, so Ram sees Hari's quizzes.
Geeta studies in *BBA · 5th Semester*, where Gopal teaches E-commerce, so she sees Gopal's quizzes and not Hari's.

## What it does

**Students**
- Register once with their name, roll number and **class**. Their subjects appear straight away, with no codes to enter.
- See every open quiz from all their subjects on one dashboard. One attempt per quiz, with an optional timer.
- Get their score as soon as they submit. They can review correct answers once the teacher closes the quiz.
- Open their **Profile** for a semester report card, grouped by class: every quiz in each subject, the total, the
  percentage, and final marks scaled to the teacher's weight (for example 8.5 / 10). The report can be printed or saved as a PDF.
- They can fix a wrong class choice themselves until they take their first quiz. After that, a teacher moves them.

**Teachers**
- Register with the faculty code and **the subjects they teach**, choosing the class of each one (or adding a new
  class). They can add more subjects later from the console.
- Write quizzes with 2–6 options per question or True/False, marks per question, a time limit, and an
  automatic close time.
- **Gradebook:** one row per student, one column per quiz, with totals, percentages and weighted final
  marks. Open a student to see every answer or to allow a retake. Export the gradebook or a single student's
  report as CSV.
- **Students page:** copy a sign-up link that pre-selects the class, move a student to another class, or move
  the whole class to its next semester at the end of term. Marks already earned stay on every student's report.
- Teachers see only their own subjects and the students of those classes. An **admin** account can see all of them.

**How semester marks are counted.** A quiz counts once the student has taken it or once it has closed. A
missed closed quiz scores 0 out of its full marks. Open quizzes a student hasn't taken yet don't count until
they close. Quizzes held before a student joined the subject (they registered late, or moved in from another
class) don't count either. If a subject has a *quiz marks in final grade* weight (such as 10), the percentage is scaled to it.

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
  quizzes into a subject called **CS-301** owned by your teacher account and enrolls every existing
  student in it. Afterwards, edit that subject to choose its class. Existing students are asked to pick their
  class the next time they open their dashboard.
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
- **Teachers first:** open the site → **Create account** → **I'm a Teacher** → enter the faculty code and add each
  subject you teach, choosing its class or adding the class (for example *BBA*, *1st Semester*). A class is open to
  students once it has at least one subject.
- **Admin (optional):** register, then run [sql/make_admin.sql](sql/make_admin.sql) with your email.
- **Students:** they register and choose their class. On the Students page, *Copy sign-up link* gives a link that
  pre-selects the class, and *Copy invite message* gives text to paste in the class group.

---

## Day-to-day use

1. **After class:** Quizzes → **+ New Quiz** → write the questions → **Publish now**. You can set an
   automatic close time, for example "+30 min".
2. Students take it from their dashboard and see their score.
3. **Close** the quiz (or let the automatic close time pass). Students can then review the correct
   answers, if you allowed it.
4. **End of semester:** Gradebook → **Export gradebook (CSV)**. Then, on the Students page, **Move class to next
   semester** (for example BBA 1st → BBA 2nd), and archive the old subject from the Subjects page. Every student
   keeps the marks they earned, and next year's students who choose BBA 1st Semester aren't added to the archived subject.

A student forgot their password right before a quiz? Run [sql/reset_student_password.sql](sql/reset_student_password.sql)
to set a temporary one immediately.

---

## Design

The look and feel follows [design-system/quizora/MASTER.md](design-system/quizora/MASTER.md),
generated with the [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) skill and then
checked by hand. It uses the Minimalism style with a teal and orange palette (every text color meets WCAG
AA contrast) and the Plus Jakarta Sans font. All color, spacing and radius values are defined as variables in
[css/main.css](css/main.css). The design also includes accessibility basics: a skip link, visible focus,
reduced-motion support, inline form errors, and touch targets of at least 24 px.

The Quizora logo files live in [assets/brand/](assets/brand/): the wordmark for the navbar, the full logo
with the "Learn . Quiz . Progress" tagline for the landing page and sign-in cards, the Q mark for the favicon,
home-screen app icons (via [manifest.webmanifest](manifest.webmanifest)) and a link-preview image.

## Security

- Grading runs inside PostgreSQL (`submit_quiz`). Students read questions through a view with no
  answer-key column, so the key never reaches their browser.
- Row Level Security isolates each teacher's data and each student's attempts. Students can't insert or edit
  attempts, change their score, or change their role, roll number or email.
- Enrollment comes only from a student's class and is maintained by database triggers, so nobody can add
  themselves to another class's subjects. Students can change their own class only until they take a quiz;
  after that only their teachers (or an admin) can move them.
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
dashboard.html        Student: class, open quizzes, subjects, recent results
quiz.html             Student: take a quiz (timer, auto-save, keyboard shortcuts)
results.html          Student: all attempts + answer review
profile.html          Student: semester report card by class, edit name/class, change password
admin/index.html      Teacher: subjects grouped by class, add/edit subjects, open quizzes
admin/quizzes.html    Teacher: quiz list per subject (publish / close / reopen / delete)
admin/create-quiz.html Teacher: quiz editor
admin/students.html   Teacher: class roster, sign-up link, move students / promote a class
admin/results.html    Teacher: semester gradebook, student reports, CSV export
js/                   One module per page plus shared auth, utils, classes, student-data, review, admin-service
css/                  Design tokens (main), components, quiz, admin, auth, landing
design-system/        Design system master file (source of truth for the UI)
sql/setup.sql         Complete database: classes, subjects, auto-enrollment, RLS, RPCs (run this)
sql/make_admin.sql    Change an account's role
sql/reset_student_password.sql  Set a temporary password
```

## Run locally

```
npm start      # serves the site at http://localhost:8080 (needs Node.js)
```
