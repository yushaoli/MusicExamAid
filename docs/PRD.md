# MusicExamAid PRD (v2.3 — Service Account, WeCom & Mini Program)

## Product goal
Provide a low-friction workflow across **WeChat Service Account (微信服务号)**, **WeCom (企业微信)**, and **WeChat Mini Program** (`https://mea.xgar.com.cn`) that helps parents and teachers complete music exam registration, review, 1-click lock, and export-ready submission packages (Template v2.1 roster + standardized portrait photo ZIP bundle), while preserving exam records and certificates in a multi-year learner archive (`考级档案`).

## Delivery channels
1. **WeChat Service Account (`https://mea.xgar.com.cn/app`)**:
   - Bottom menu entry (`我要报名` / `考级档案` / `老师工作台`) for instant H5 access on phone, tablet, and PC without Mini Program release delays.
   - Push **Template Messages (模板消息)** to parents whenever a registration needs changes (`needs_change`), is confirmed (`confirmed`), or is locked (`locked`).
2. **WeCom (`https://wecom.xgar.com.cn/send/<token>`)**:
   - Real-time markdown push notifications to teachers, institution admins, and super operators when registrations are submitted or export bundles are generated.
3. **WeChat Mini Program (`apps/wechat-mini`, `wx_mini_program_appid`)**:
   - Connected to `https://mea.xgar.com.cn/rpc/:action` via zero-rewrite RPC bridge; also serves student practice workflows (`音乐基础知识`, `乐器陪练`, `水平评估`).

## Primary users
- **Parent / guardian**: Creates learner profile (AES-256-GCM encrypted ID), submits exam registration, receives Service Account review notifications, and maintains the child's exam archive (`考级档案`).
- **Teacher**: Reviews roster, requests changes or performs **1-click Confirm & Lock** (`submitted → locked`), and receives WeCom alerts.
- **Institution Admin & Super Operator**: Audits locked registrations and downloads the one-click **Export ZIP Bundle** (`报名汇总表.csv` + `photos/{证件号码}_{姓名}.jpg` + `manifest.json`) from PC or mobile.
- **Student**: Uses practice and assessment modes.

## MVP scope
1. Learner profile management with AES-256-GCM encrypted ID at rest and masked `id_last4` display
2. Exam registration record creation per cycle with canonical subject name resolution (`"piano" → "钢琴"`)
3. Teacher review + streamlined status transitions (`draft / submitted / needs_change / confirmed / locked`, including 1-click `submitted → locked`)
4. Closed-loop WeCom + WeChat Service Account notifications
5. Archive of exam results/certificate metadata + attachments (`考级档案`)
6. Export pipeline producing both Template v2.1 Excel CSV (`/exports/:job_id/csv`) and complete Roster + Portrait Photo ZIP bundles (`/exports/:job_id/bundle.zip`)

## Non-goals (MVP)
- WeChat Pay
- Automated scraping from official exam portals
- Full LMS/course management

## Success criteria
- Parent can submit a complete registration from the Service Account menu in <5 minutes and receive instant WeChat Template Message feedback on teacher review
- Teacher can confirm and lock a registration in 1 click (`submitted → locked`)
- Export ZIP bundle includes both the strict 25-column Template v2.1 roster (without scientific-notation corruption) and standardized `photos/{证件号码}_{姓名}.jpg` files
- Plaintext ID numbers are never returned to clients or stored unencrypted in `snapshot_json`
