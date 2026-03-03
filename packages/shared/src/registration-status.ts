/**
 * Registration workflow state machine.
 *
 * States
 * ------
 *   draft        – record created, parent editing
 *   submitted    – parent submitted for teacher review
 *   needs_change – teacher requested corrections; parent can re-edit
 *   confirmed    – teacher approved the submission
 *   locked       – teacher locked the record for institution handoff
 *
 * Allowed transitions
 * -------------------
 *   draft        → submitted       (parent submits)
 *   submitted    → needs_change    (teacher requests changes)
 *   submitted    → confirmed       (teacher confirms)
 *   needs_change → submitted       (parent resubmits after fixing)
 *   confirmed    → locked          (teacher locks)
 *   locked       → confirmed       (teacher unlocks for correction)
 */

// ---------------------------------------------------------------------------
// Status constants
// ---------------------------------------------------------------------------

export const RegistrationStatus = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  NEEDS_CHANGE: 'needs_change',
  CONFIRMED: 'confirmed',
  LOCKED: 'locked',
} as const;

export type RegistrationStatus =
  (typeof RegistrationStatus)[keyof typeof RegistrationStatus];

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

export const VALID_TRANSITIONS: Readonly<
  Record<RegistrationStatus, ReadonlyArray<RegistrationStatus>>
> = {
  [RegistrationStatus.DRAFT]: [RegistrationStatus.SUBMITTED],
  [RegistrationStatus.SUBMITTED]: [
    RegistrationStatus.NEEDS_CHANGE,
    RegistrationStatus.CONFIRMED,
  ],
  [RegistrationStatus.NEEDS_CHANGE]: [RegistrationStatus.SUBMITTED],
  [RegistrationStatus.CONFIRMED]: [RegistrationStatus.LOCKED],
  [RegistrationStatus.LOCKED]: [RegistrationStatus.CONFIRMED],
};

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Returns `true` if the `from → to` transition is permitted. */
export function canTransition(
  from: RegistrationStatus,
  to: RegistrationStatus,
): boolean {
  return (VALID_TRANSITIONS[from] as ReadonlyArray<string>).includes(to);
}

/**
 * Asserts that the `from → to` transition is permitted.
 * Throws a descriptive `Error` if not.
 */
export function assertTransition(
  from: RegistrationStatus,
  to: RegistrationStatus,
): void {
  if (!canTransition(from, to)) {
    const allowed = VALID_TRANSITIONS[from].join(', ') || '(none)';
    throw new Error(
      `Invalid status transition: "${from}" → "${to}". ` +
        `Allowed from "${from}": ${allowed}`,
    );
  }
}
