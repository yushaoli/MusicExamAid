export { loadConfig, parseEnvFile } from './env-config';
export type { Config } from './env-config';

export {
  RegistrationStatus,
  VALID_TRANSITIONS,
  canTransition,
  assertTransition,
} from './registration-status';
export type { RegistrationStatus as RegistrationStatusType } from './registration-status';

export {
  computeWeChatSignature,
  verifyWeChatSignature,
  redactPii,
  formatWeComStatusAlert,
  formatWeComExportAlert,
  buildServiceAccountTemplatePayload,
  buildServiceAccountMenuConfig,
} from './wechat-wecom';
export type {
  WeComStatusAlertInput,
  WeComExportAlertInput,
  ServiceAccountTemplateInput,
  ServiceAccountTemplatePayload,
} from './wechat-wecom';

export {
  SUBJECT_NAME_MAP,
  resolveSubjectName,
  encryptIdNumber,
  decryptIdNumber,
  getIdLast4,
  buildRegistrationSnapshot,
  computeMissingFlags,
  TEMPLATE_V2_1_HEADERS,
  mapSnapshotToExportRow,
  serializeExportRowsToCsv,
} from './snapshot-crypto';
export type {
  SnapshotLearnerInput,
  SnapshotRegistrationInput,
  SnapshotInstitutionInput,
  SnapshotTeacherInput,
  RegistrationSnapshot,
} from './snapshot-crypto';

export {
  crc32,
  buildZipArchive,
  formatPortraitPhotoZipPath,
  buildExportZipBundle,
} from './zip-bundle';
export type { ZipEntryInput, PortraitPhotoAsset } from './zip-bundle';

export { computeDedupKey, evaluateBatchDedup } from './dedup';
export type {
  DedupRegistrationCandidate,
  DedupResolutionStatus,
  DedupConflictReason,
  DedupEvaluatedItem,
} from './dedup';

export {
  normalizeLevelKey,
  getDefaultFeeRuleForLevel,
  resolveTeacherGradeRate,
  formatRmbYuan,
  summarizeTeacherWallet,
} from './concession-ledger';
export type {
  PaymentOrderStatus,
  ConcessionLedgerStatus,
  WithdrawalStatus,
  ExamFeeRule,
  TeacherGradeRateCard,
  ResolvedTeacherGradeRate,
  PaymentOrderRecord,
  ConcessionLedgerRecord,
  TeacherWithdrawalRecord,
  TeacherWalletSummary,
} from './concession-ledger';

export {
  OFFICIAL_PORTAL_BASE_URL,
  parseOfficialAdminLoginHtml,
  buildStudentIdentityKey,
  consolidateOfficialAndHelperRegistrations,
} from './official-sync';
export type {
  OfficialPortalQrSession,
  ChannelRegistrationInput,
  ConsolidationCategory,
  ConsolidatedStudentItem,
  ConsolidationReport,
} from './official-sync';



