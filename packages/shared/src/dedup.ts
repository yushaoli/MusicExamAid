/**
 * SuperBatch deduplication & conflict resolution engine (v2.3).
 *
 * Rules (from SPEC_v2.2.1 & DESIGN_RECONCILIATION.md):
 * - Dedup key: `${learner_id}|${cycle_id}|${subject_id}`
 * - Single item for key: `included`
 * - Multiple items for key with identical `level` and `institution_id`:
 *     Auto-keep the item with the newest `locked_at` (`included`);
 *     mark older items as `auto_excluded_duplicate`.
 * - Multiple items for key with different `level` OR different `institution_id`:
 *     Mark all items in that group as `conflict_pending` (with reason
 *     `level_mismatch` or `cross_institution_collision`) until operator resolves.
 */

export interface DedupRegistrationCandidate {
  id: string;
  learner_id: string;
  institution_id: string | null;
  cycle_id: string;
  subject_id: string;
  level: number;
  locked_at: string | null;
}

export type DedupResolutionStatus =
  | 'included'
  | 'auto_excluded_duplicate'
  | 'conflict_pending'
  | 'manually_included'
  | 'manually_excluded';

export type DedupConflictReason =
  | 'none'
  | 'same_level_older_duplicate'
  | 'level_mismatch'
  | 'cross_institution_collision';

export interface DedupEvaluatedItem extends DedupRegistrationCandidate {
  dedup_key: string;
  resolution_status: DedupResolutionStatus;
  conflict_reason: DedupConflictReason;
}

export function computeDedupKey(item: {
  learner_id: string;
  cycle_id: string;
  subject_id: string;
}): string {
  return `${item.learner_id}|${item.cycle_id}|${item.subject_id}`;
}

/**
 * Evaluate a batch of locked registration candidates for deduplication and conflicts.
 */
export function evaluateBatchDedup(
  candidates: ReadonlyArray<DedupRegistrationCandidate>,
): {
  items: DedupEvaluatedItem[];
  included_ids: string[];
  excluded_ids: string[];
  conflict_ids: string[];
} {
  const groups = new Map<string, DedupRegistrationCandidate[]>();
  for (const c of candidates) {
    const key = computeDedupKey(c);
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const items: DedupEvaluatedItem[] = [];

  for (const [key, group] of groups.entries()) {
    if (group.length === 1) {
      items.push({
        ...group[0],
        dedup_key: key,
        resolution_status: 'included',
        conflict_reason: 'none',
      });
      continue;
    }

    const levels = new Set(group.map(g => g.level));
    const institutions = new Set(group.map(g => g.institution_id ?? ''));

    if (institutions.size > 1) {
      for (const g of group) {
        items.push({
          ...g,
          dedup_key: key,
          resolution_status: 'conflict_pending',
          conflict_reason: 'cross_institution_collision',
        });
      }
      continue;
    }

    if (levels.size > 1) {
      for (const g of group) {
        items.push({
          ...g,
          dedup_key: key,
          resolution_status: 'conflict_pending',
          conflict_reason: 'level_mismatch',
        });
      }
      continue;
    }

    // Same level and same institution: auto-keep newest locked_at
    const sorted = [...group].sort((a, b) => {
      const ta = a.locked_at ? Date.parse(a.locked_at) : 0;
      const tb = b.locked_at ? Date.parse(b.locked_at) : 0;
      return tb - ta;
    });

    items.push({
      ...sorted[0],
      dedup_key: key,
      resolution_status: 'included',
      conflict_reason: 'none',
    });

    for (let i = 1; i < sorted.length; i++) {
      items.push({
        ...sorted[i],
        dedup_key: key,
        resolution_status: 'auto_excluded_duplicate',
        conflict_reason: 'same_level_older_duplicate',
      });
    }
  }

  return {
    items,
    included_ids: items
      .filter(i => i.resolution_status === 'included')
      .map(i => i.id),
    excluded_ids: items
      .filter(i => i.resolution_status === 'auto_excluded_duplicate')
      .map(i => i.id),
    conflict_ids: items
      .filter(i => i.resolution_status === 'conflict_pending')
      .map(i => i.id),
  };
}
