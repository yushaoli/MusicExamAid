/**
 * Official Exam Portal (`https://kjzx002120.kj5.zgyyxykj.com/admins` —
 * 江西小戈尔文化艺术有限公司考级办管理后台) Auth Parser & Cross-Channel Consolidation Engine.
 *
 * Handles:
 * 1. Parsing the official login HTML (`GET /admins`) to extract:
 *    - `PHPSESSID` session cookie
 *    - Base64 WeChat scan QR image (`data:image/png;base64,...`)
 *    - `wxauth` polling token (`get_wxauth_status('<token>', ...)`)
 * 2. Consolidating registrations from two channels:
 *    - `helper`: Registered via our MusicExamAid Mini Program / H5 Helper
 *    - `official_portal`: Registered directly on `kjzx002120.kj5.zgyyxykj.com`
 * 3. Cross-channel deduplication & delta classification:
 *    - `helper_only`: Needs to be exported/synced to the official portal
 *    - `official_only`: Imported from official portal into local master DB + teacher concession ledger
 *    - `matched_both`: Registered in both places (same grade) -> merged so student isn't double-counted
 *    - `conflict_grade`: Registered in both places with different grades -> flagged for operator review
 */

import { resolveSubjectName } from './snapshot-crypto';
import { normalizeLevelKey } from './concession-ledger';

export const OFFICIAL_PORTAL_BASE_URL = 'https://kjzx002120.kj5.zgyyxykj.com';

export interface OfficialPortalQrSession {
  portal_url: string;
  php_sess_id: string;
  wxauth_token: string;
  qr_image_base64: string;
  portal_title: string;
}

/**
 * Extract `wxauth_token`, `qr_image_base64`, and `portal_title` from the HTML of
 * `GET https://kjzx002120.kj5.zgyyxykj.com/admins`.
 */
export function parseOfficialAdminLoginHtml(
  html: string,
  phpSessId = '',
): OfficialPortalQrSession {
  const tokenMatch =
    /get_wxauth_status\(\s*['"]([A-Za-z0-9_-]+)['"]/i.exec(html) ||
    /wxauth_confirm\?token=([A-Za-z0-9_-]+)/i.exec(html);
  const qrMatch = /<img\s+src=["'](data:image\/png;base64,[^"']+)["']/i.exec(html);
  const titleMatch = /<div class=["']qr-lg-title["']>([^<]+)<\/div>/i.exec(html);

  return {
    portal_url: `${OFFICIAL_PORTAL_BASE_URL}/admins`,
    php_sess_id: phpSessId,
    wxauth_token: tokenMatch?.[1] ?? '',
    qr_image_base64: qrMatch?.[1] ?? '',
    portal_title:
      titleMatch?.[1]?.trim() || '江西小戈尔文化艺术有限公司考级办管理后台',
  };
}

export interface ChannelRegistrationInput {
  registration_id: string;
  source: 'helper' | 'official_portal';
  name_cn: string;
  id_number_or_last4: string;
  cycle_id: string;
  subject_id: string;
  level: string | number;
  teacher_id: string;
  fee_paid_fen?: number;
}

export type ConsolidationCategory =
  | 'helper_only'      // Registered in helper only -> ready to push/export to official website
  | 'official_only'    // Registered on official website only -> imported into helper & teacher concession ledger
  | 'matched_both'     // Present in both with same grade -> deduplicated into 1 canonical record
  | 'conflict_grade';  // Present in both with different grades -> needs operator check

export interface ConsolidatedStudentItem {
  identity_key: string;
  name_cn: string;
  id_number_or_last4: string;
  cycle_id: string;
  subject_name: string;
  level: string;
  teacher_id: string;
  category: ConsolidationCategory;
  helper_registration_id?: string;
  official_registration_id?: string;
  conflict_detail?: string;
}

export interface ConsolidationReport {
  total_unique_students: number;
  helper_only_count: number;
  official_only_count: number;
  matched_both_count: number;
  conflict_count: number;
  items: ConsolidatedStudentItem[];
}

export function buildStudentIdentityKey(item: {
  name_cn: string;
  id_number_or_last4: string;
  cycle_id: string;
  subject_id: string;
}): string {
  const last4 = String(item.id_number_or_last4).trim().slice(-4).toUpperCase();
  const subjectCn = resolveSubjectName(item.subject_id);
  return `${item.cycle_id}::${subjectCn}::${item.name_cn.trim()}::${last4}`;
}

/**
 * Consolidate registrations from our MusicExamAid Helper (`helper`) and the Official Website
 * (`official_portal`: `https://kjzx002120.kj5.zgyyxykj.com/admins`).
 */
export function consolidateOfficialAndHelperRegistrations(
  helperItems: ChannelRegistrationInput[],
  officialItems: ChannelRegistrationInput[],
): ConsolidationReport {
  const helperMap = new Map<string, ChannelRegistrationInput>();
  for (const h of helperItems) {
    helperMap.set(buildStudentIdentityKey(h), h);
  }

  const officialMap = new Map<string, ChannelRegistrationInput>();
  for (const o of officialItems) {
    officialMap.set(buildStudentIdentityKey(o), o);
  }

  const allKeys = new Set<string>([
    ...helperMap.keys(),
    ...officialMap.keys(),
  ]);

  const items: ConsolidatedStudentItem[] = [];
  let helperOnlyCount = 0;
  let officialOnlyCount = 0;
  let matchedBothCount = 0;
  let conflictCount = 0;

  for (const key of allKeys) {
    const h = helperMap.get(key);
    const o = officialMap.get(key);

    if (h && !o) {
      helperOnlyCount += 1;
      items.push({
        identity_key: key,
        name_cn: h.name_cn,
        id_number_or_last4: h.id_number_or_last4,
        cycle_id: h.cycle_id,
        subject_name: resolveSubjectName(h.subject_id),
        level: normalizeLevelKey(h.level),
        teacher_id: h.teacher_id,
        category: 'helper_only',
        helper_registration_id: h.registration_id,
      });
    } else if (!h && o) {
      officialOnlyCount += 1;
      items.push({
        identity_key: key,
        name_cn: o.name_cn,
        id_number_or_last4: o.id_number_or_last4,
        cycle_id: o.cycle_id,
        subject_name: resolveSubjectName(o.subject_id),
        level: normalizeLevelKey(o.level),
        teacher_id: o.teacher_id,
        category: 'official_only',
        official_registration_id: o.registration_id,
      });
    } else if (h && o) {
      const hLevel = normalizeLevelKey(h.level);
      const oLevel = normalizeLevelKey(o.level);
      if (hLevel === oLevel) {
        matchedBothCount += 1;
        items.push({
          identity_key: key,
          name_cn: h.name_cn,
          id_number_or_last4: h.id_number_or_last4,
          cycle_id: h.cycle_id,
          subject_name: resolveSubjectName(h.subject_id),
          level: hLevel,
          teacher_id: h.teacher_id || o.teacher_id,
          category: 'matched_both',
          helper_registration_id: h.registration_id,
          official_registration_id: o.registration_id,
        });
      } else {
        conflictCount += 1;
        items.push({
          identity_key: key,
          name_cn: h.name_cn,
          id_number_or_last4: h.id_number_or_last4,
          cycle_id: h.cycle_id,
          subject_name: resolveSubjectName(h.subject_id),
          level: `${hLevel} vs ${oLevel}`,
          teacher_id: h.teacher_id || o.teacher_id,
          category: 'conflict_grade',
          helper_registration_id: h.registration_id,
          official_registration_id: o.registration_id,
          conflict_detail: `助手填报 ${hLevel}级 vs 官网直报 ${oLevel}级`,
        });
      }
    }
  }

  return {
    total_unique_students: items.length,
    helper_only_count: helperOnlyCount,
    official_only_count: officialOnlyCount,
    matched_both_count: matchedBothCount,
    conflict_count: conflictCount,
    items,
  };
}
