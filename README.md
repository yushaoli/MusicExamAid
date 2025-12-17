### About project

Provide an overview of the project’s goals and context

MVP **Product Documentation Pack 1.0**

**1) Product scope statement**

Product: WeChat Mini Program “考级助手 / Music Exam Aid”

MVP Objective: Enable parents to create student profiles and exam-cycle registrations, enable teachers to review/confirm/lock, and export an upload-ready Excel template; additionally provide a “考级档案” vault where families can save 国音 exam results/certificates (assisted sync via official query pages).

Non-goals (MVP): WeChat Pay, automated scraping/auto-sync from 国音, full teaching LMS, end-to-end official system submission.

**2) Personas and responsibilities**

**Parent (WeChat account owner)**

- Create/manage child (learner) profiles
- Create registration record per exam cycle
- Submit registration to teacher
- Save exam results/certificates into “考级档案”

**Student (practice actor, uses parent’s phone)**

- Uses three exercise modes:
    - 音乐基础知识
    - 乐器陪练
    - 水平评估

**Teacher (limited console)**

- View roster of linked learners
- Review/edit/confirm/lock registrations
- Export Excel for official upload
- View “考级档案” for eligibility and accuracy checks

**3) Information architecture**

**Tabs (suggested)**

- 练习 Practice
- 考级 Exam (Registration + Archive)
- 进度 Progress
- 我的 Me

**Inside Practice**

- 音乐基础知识（Quiz + 错题本）
- 乐器陪练（Record → AI feedback → drills → re-record）
- 水平评估（Mock assessment session → readiness + gaps)

**Inside Exam**

- 报名信息（Registration records per cycle）
- 考级档案（国音 results/certificates vault)
