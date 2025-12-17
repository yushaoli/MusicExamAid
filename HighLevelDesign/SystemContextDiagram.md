System Context Diagram

flowchart LR
  %% --- CLIENTS ---
  P["Parent (WeChat)"] --> MP["Mini Program<br/>考级助手 / Music Exam Aid"]
  S["Student (uses parent's device)"] --> MP
  T["Teacher"] --> TC["Teacher Console<br/>(limited UI)"]

  %% --- PLATFORM / INTEGRATIONS ---
  MP -->| "WeChat Login (OpenID)" | WA["WeChat Auth"]
  TC -->| "WeChat Login (OpenID)" | WA

  %% --- CORE BACKEND ---
  MP -->| "API calls" | BE["Backend API"]
  TC -->| "API calls" | BE

  %% --- DATA STORES ---
  BE --> DB["Database<br/>(Profiles / Registrations / Certifications / Audit)"]
  BE --> OS["Object Storage<br/>(Attachments)"]

  %% --- EXPORT ---
  BE --> EX["Excel Export Service<br/>(Template v2.1)"]
  EX -->| "Generate .xlsx" | OS
  TC -->| "Download export" | OS
  TC -->| "Upload template manually" | OUS["Official Upload System<br/>(external)"]

  %% --- GUOYIN (ASSISTED) ---
  MP -->| "Open WebView" | GW["国音 Website<br/>(成绩/证书查询)"]
  MP -->| "Save summary + attachments" | BE
