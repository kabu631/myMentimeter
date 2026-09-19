# 🎓 Daily Class Quiz System

A free, lightweight, web-based daily quiz platform built for college courses (designed for ~35 semester classes).

Hosted 100% free on **GitHub Pages** with a PostgreSQL database and authentication provided by **Supabase**.

---

## 🌟 Key Features

* **Zero-Cost Serverless Stack**: No Node.js backend, no React, no paid hosting. Pure HTML5, CSS3, and Vanilla JavaScript (ES Modules).
* **Anti-Cheat Database Grading**:
  * Correct answers are **never sent to student browser DevTools**.
  * Grading is executed entirely server-side inside PostgreSQL via the `submit_quiz` RPC stored procedure.
  * Single-attempt constraint (`unique_student_quiz_attempt`) prevents duplicate submissions.
* **Student Experience**:
  * Single-time registration with College Roll Number.
  * Live status detection on dashboard: Today's active quiz banner, immediate scores, and semester attendance tracking.
  * Distraction-free quiz engine with optional countdown timer, option selection pills, and question jump palette.
  * Full semester history table with cumulative score progress bar across all 35 classes.
* **Teacher Command Center**:
  * Intuitive Quiz Builder: Write multiple choice questions, designate correct answers, configure points, and draft or publish.
  * Live Student Gradebook: View enrolled students, individual quiz scores, and cumulative averages.
  * **One-Click CSV Export**: Downloads an RFC 4180 compliant spreadsheet matrix (Students × Classes 1–35 + Total).
  * Safety guards prevent editing question content once student attempts have been submitted.

---

## 📁 Project Structure

```
myMentimeter/
├── index.html              # Student Dashboard (Today's Quiz alert + Semester Stats)
├── auth.html               # Unified Login & Student Registration
├── quiz.html               # Clean, Distraction-Free Quiz Taking Engine
├── results.html            # Post-Quiz Score Breakdown & Question Review
├── history.html            # Complete 35-Class Quiz History & Cumulative Score
├── admin.html              # Teacher Command Center (Quizzes, Students, CSV Export)
├── edit-quiz.html          # Teacher Quiz Creator & Question Builder
├── css/
│   ├── main.css            # CSS variables, typography, reset, card layout, dark/light theme
│   ├── components.css      # Reusable buttons, badges, modals, alerts, tables, progress bars
│   ├── auth.css            # Clean modern form cards & tab toggle styles
│   ├── quiz.css            # MCQ radio cards, timer header, question palette/grid
│   └── admin.css           # Metric counters, data tables, filter tabs, drawer panel
├── js/
│   ├── config.js           # Supabase URL & Public Anon Key configuration
│   ├── supabase.js         # Supabase client singleton & error handling utilities
│   ├── auth.js             # Session management, login, signup, logout, role verification
│   ├── student-dash.js     # Detects today's quiz, loads semester progress overview
│   ├── quiz-runner.js      # Handles timer, question navigation, option selection, submit RPC
│   ├── results.js          # Renders score cards and review breakdown
│   ├── history.js          # Renders student's complete 35-class quiz performance
│   ├── admin-dash.js       # Teacher stats, quiz list, status toggles, student scores table
│   ├── quiz-builder.js     # Dynamic form to add/edit MCQs, draft/publish controls
│   └── export-csv.js       # Browser-side CSV generator for semester gradebook matrix
├── sql/
│   ├── 01_schema.sql       # Tables, primary/foreign keys, constraints, and indexes
│   ├── 02_security_rls.sql # Row Level Security policies and helper role check functions
│   ├── 03_rpc_grading.sql  # submit_quiz RPC function and auth trigger for profiles
│   └── 04_seed_sample_quiz.sql # Ready-to-use Class 01 quiz for immediate testing
└── README.md
```

---

## 🚀 Setup Guide (Takes ~5 Minutes)

### Step 1: Create a Free Supabase Project

1. Go to [https://supabase.com](https://supabase.com) and create a free account.
2. Click **"New Project"**, select your region, and choose a database password.
3. Once the project finishes provisioning, go to **Project Settings > API**:
   * Copy your **Project URL** (e.g., `https://xyz.supabase.co`).
   * Copy your **anon / public** key (starts with `eyJ...`).

---

### Step 2: Run the SQL Scripts in Supabase

In your Supabase dashboard, click **SQL Editor** in the left sidebar, create a new query, and run the following files in order:

1. Copy and paste `sql/01_schema.sql` &rarr; Click **Run**.
2. Copy and paste `sql/02_security_rls.sql` &rarr; Click **Run**.
3. Copy and paste `sql/03_rpc_grading.sql` &rarr; Click **Run**.
4. *(Optional for instant testing)*: Copy and paste `sql/04_seed_sample_quiz.sql` &rarr; Click **Run**. This immediately creates an active Class 01 quiz on Introduction to DBMS!

---

### Step 3: Configure Frontend Credentials

You have two easy options:

#### Option A: Quick UI Configuration (No Code Edits)
When you open `index.html` or `auth.html` in your browser, a setup modal will automatically prompt you to paste your Supabase URL and Anon Key. They will be saved directly into your browser's `localStorage`.

#### Option B: In `js/config.js`
Open `js/config.js` and replace the placeholder strings:
```javascript
export const APP_CONFIG = {
  SUPABASE_URL: 'https://YOUR_PROJECT_ID.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  ...
};
```

---

### Step 4: Create & Promote Your Teacher Account

1. Open `auth.html` in your browser.
2. Click the **Student Register** tab and register an account using your faculty email (e.g., `prof.smith@college.edu`).
3. To promote this account to teacher/admin status, open the **Supabase SQL Editor** and execute:
   ```sql
   UPDATE public.profiles 
   SET role = 'teacher' 
   WHERE email = 'prof.smith@college.edu';
   ```
4. Now sign in through the **Teacher Portal** tab on `auth.html` to access the Teacher Command Center!

---

## 🌐 Deploying to GitHub Pages

1. Push this entire repository to your GitHub account (e.g. `https://github.com/your-username/myMentimeter`).
2. In your repository on GitHub, go to **Settings > Pages**.
3. Under **Build and deployment**:
   * **Source**: Select `Deploy from a branch`.
   * **Branch**: Select `main` (or `master`) and folder `/ (root)`.
4. Click **Save**.
5. After 1–2 minutes, your website will be live at:
   `https://your-username.github.io/myMentimeter/`

---

## 🔒 Security Summary

* **Public Anon Key Only**: The `service_role` secret key is never embedded in client files.
* **Row Level Security**:
  * Students can only read and query their own attempts and answers.
  * Direct table `INSERT` or score modifications on `quiz_attempts` are blocked; submissions must pass through `submit_quiz()`.
* **DevTools Immunity**: Correct answer keys (`correct_option`) are excluded from student queries and views.
