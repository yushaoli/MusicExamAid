Understood. Below are the **Mermaid diagrams** that convert Task #1 into a high-level **screen IA + screen flow**, consistent with your conventions (clear sectioning, stable naming, and quoted labels where appropriate).

---

# Diagrams — Screen IA + Screen Flow (MVP v1.1)

## A) Screen IA Map (Parent + Teacher)

```mermaid
flowchart TB
  A["Mini Program<br/>考级助手 / Music Exam Aid"] --> P["Parent/Household UI"]
  A --> T["Teacher Console<br/>(limited UI)"]

  %% --- Parent Tabs ---
  P --> P_Practice["Practice 练习"]
  P --> P_Exam["Exam 考级"]
  P --> P_Progress["Progress 进度"]
  P --> P_Me["Me 我的"]

  %% Practice
  P_Practice --> P10["P10 Practice Mode Selector"]
  P10 --> P11["P11 音乐基础知识 (Quiz)"]
  P10 --> P12["P12 乐器陪练 (Record + Feedback)"]
  P10 --> P13["P13 水平评估 (Assessment)"]

  %% Exam
  P_Exam --> P20["P20 Exam Hub"]
  P20 --> R1["R1 报名信息 Registration List (by cycle)"]
  P20 --> A1["A1 考级档案 Archive List (国音)"]
  P20 --> C1["C1 证书管理 Certification List"]

  %% Registration Screens
  R1 --> R2["R2 Create RegistrationRecord"]
  R1 --> R3["R3 Registration Detail"]
  R2 --> R4["R4 Submit Confirmation"]
  R3 --> R4
  R4 --> R1

  %% Archive Screens
  A1 --> A2["A2 国音查询入口 (WebView launcher)"]
  A2 --> A2S["A2S 国音成绩查询 WebView"]
  A2 --> A2C["A2C 国音证书查询 WebView"]
  A1 --> A3["A3 Save Archive Record (manual)"]

  %% Certification Screens
  C1 --> C2["C2 Certification Create/Edit"]

  %% Me
  P_Me --> M1["M1 Learner Profiles"]
  P_Me --> M2["M2 Consent & Privacy Settings"]

  %% --- Teacher Console ---
  T --> T0["T0 Teacher Login / Bind MusicClass"]
  T0 --> T1["T1 Roster (MusicClass + cycle + status)"]
  T1 --> T2["T2 Student Detail (tabs)"]
  T2 --> T2a["T2a Profile Tab"]
  T2 --> T2b["T2b Registration Tab"]
  T2 --> T2c["T2c Archive/Certification Tab"]
  T1 --> T4["T4 Export (Template v2.1)"]
```

---

## B) Parent Core Screen Flow (Registration + Archive + Certification)

```mermaid
flowchart TB
  %% --- ENTRY ---
  P0["P0 WeChat Auth (implicit)"] --> G0["G0 Privacy & Terms Gate"]
  G0 --> P2["P2 Home (Learner Selector + Quick Actions)"]

  %% --- LEARNER MANAGEMENT ---
  P2 --> M1["M1 Learner Profiles"]
  M1 --> P1["P1 Create/Edit LearnerProfile"]
  P1 --> M1
  M1 --> P2

  %% --- REGISTRATION ---
  P2 --> P20["P20 Exam Hub"]
  P20 --> R1["R1 Registration List (cycle)"]
  R1 --> R2["R2 Create RegistrationRecord (Draft)"]
  R2 --> R4["R4 Submit Confirmation"]
  R4 --> R1
  R1 --> R3["R3 Registration Detail"]
  R3 --> R4

  %% --- STATUS TRACKING ---
  R1 --> R5["R5 Status Tracking View"]
  R5 --> R3

  %% --- ARCHIVE (GUOYIN ASSISTED) ---
  P20 --> A1["A1 Archive List"]
  A1 --> A2["A2 国音查询入口"]
  A2 --> A2S["A2S 成绩查询 WebView"]
  A2 --> A2C["A2C 证书查询 WebView"]
  A2S --> A3["A3 Save Archive Record (manual)"]
  A2C --> A3
  A1 --> A3
  A3 --> A1

  %% --- CERTIFICATIONS ---
  P20 --> C1["C1 Certification List"]
  C1 --> C2["C2 Certification Create/Edit"]
  C2 --> C1
```

---

## C) Teacher Core Screen Flow (Review → Confirm/Lock → Export)

```mermaid
flowchart TB
  T0["T0 Teacher Login / Bind MusicClass"] --> T1["T1 Roster (filters: cycle/status/subject/level)"]
  T1 --> T2["T2 Student Detail"]
  T2 --> T2a["T2a Profile Tab (limited edits)"]
  T2 --> T2b["T2b Registration Tab (review actions)"]
  T2 --> T2c["T2c Archive/Certification Tab"]

  %% Actions on Registration
  T2b --> A_Reject["Action: NeedsChanges + notes"]
  T2b --> A_Confirm["Action: Confirmed"]
  T2b --> A_Lock["Action: Locked + write snapshot_json"]

  A_Reject --> T1
  A_Confirm --> T1
  A_Lock --> T1

  %% Export
  T1 --> T4["T4 Export (Locked only, Template v2.1)"]
  T4 --> T1
```

---

## D) Consent Micro-Gates (Sensitive Data Progressive Collection)

```mermaid
flowchart TB
  G0["G0 Privacy & Terms Gate"] --> P2["P2 Home"]

  %% Progressive collection
  P2 --> R2["R2 Create RegistrationRecord"]
  R2 --> C_S1["Gate S1: 'Sensitive PI Consent'<br/>(ID number, portrait photo, certificates)"]
  C_S1 --> R2F["Registration Form Sections"]
  R2F --> C_S2["Gate S2: 'Upload Consent'<br/>(portrait_photo / id_front)"]
  C_S2 --> R4["R4 Submit Confirmation"]
  R4 --> R1["R1 Registration List"]
```

---

## E) Registration State + Screen Ownership Map

```mermaid
flowchart TB
  D["Draft"] --> S["Submitted"]
  S --> N["NeedsChanges"]
  N --> S
  S --> C["Confirmed"]
  C --> L["Locked"]
  L --> C

  %% Ownership hints
  D --- P1["Parent can edit"]
  N --- P2["Parent edits per notes"]
  S --- T1["Teacher reviews"]
  C --- T2["Teacher confirms"]
  L --- T3["Teacher locks + export eligible"]
```

---

If you confirm the **single “default template v2.1”** as the MVP export template (no regional variants for now), I will proceed next with a tightened **screen-by-screen field list** (exact form fields per screen, with required/optional flags derived from the export template) so development can start with minimal ambiguity.
