import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  RegistrationStatus as RS,
  VALID_TRANSITIONS,
  canTransition,
  assertTransition,
} from '../registration-status';

// ---------------------------------------------------------------------------
// canTransition – valid transitions
// ---------------------------------------------------------------------------

describe('canTransition – valid transitions', () => {
  it('draft → submitted', () => {
    assert.equal(canTransition(RS.DRAFT, RS.SUBMITTED), true);
  });

  it('submitted → needs_change', () => {
    assert.equal(canTransition(RS.SUBMITTED, RS.NEEDS_CHANGE), true);
  });

  it('submitted → confirmed', () => {
    assert.equal(canTransition(RS.SUBMITTED, RS.CONFIRMED), true);
  });

  it('needs_change → submitted', () => {
    assert.equal(canTransition(RS.NEEDS_CHANGE, RS.SUBMITTED), true);
  });

  it('confirmed → locked', () => {
    assert.equal(canTransition(RS.CONFIRMED, RS.LOCKED), true);
  });

  it('locked → confirmed (unlock)', () => {
    assert.equal(canTransition(RS.LOCKED, RS.CONFIRMED), true);
  });
});

// ---------------------------------------------------------------------------
// canTransition – invalid transitions
// ---------------------------------------------------------------------------

describe('canTransition – invalid transitions', () => {
  it('draft → confirmed', () => {
    assert.equal(canTransition(RS.DRAFT, RS.CONFIRMED), false);
  });

  it('draft → locked', () => {
    assert.equal(canTransition(RS.DRAFT, RS.LOCKED), false);
  });

  it('locked → draft', () => {
    assert.equal(canTransition(RS.LOCKED, RS.DRAFT), false);
  });

  it('locked → submitted', () => {
    assert.equal(canTransition(RS.LOCKED, RS.SUBMITTED), false);
  });

  it('confirmed → submitted (skip back)', () => {
    assert.equal(canTransition(RS.CONFIRMED, RS.SUBMITTED), false);
  });

  it('confirmed → draft (skip back)', () => {
    assert.equal(canTransition(RS.CONFIRMED, RS.DRAFT), false);
  });
});

// ---------------------------------------------------------------------------
// assertTransition
// ---------------------------------------------------------------------------

describe('assertTransition', () => {
  it('does not throw for valid transition', () => {
    assert.doesNotThrow(() => assertTransition(RS.DRAFT, RS.SUBMITTED));
    assert.doesNotThrow(() => assertTransition(RS.CONFIRMED, RS.LOCKED));
    assert.doesNotThrow(() => assertTransition(RS.LOCKED, RS.CONFIRMED));
  });

  it('throws for invalid transition', () => {
    assert.throws(() => assertTransition(RS.DRAFT, RS.LOCKED));
  });

  it('error message includes both states', () => {
    assert.throws(
      () => assertTransition(RS.DRAFT, RS.LOCKED),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes(RS.DRAFT),
          `expected "${RS.DRAFT}" in message: ${err.message}`,
        );
        assert.ok(
          err.message.includes(RS.LOCKED),
          `expected "${RS.LOCKED}" in message: ${err.message}`,
        );
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// VALID_TRANSITIONS completeness
// ---------------------------------------------------------------------------

describe('VALID_TRANSITIONS', () => {
  it('has an entry for every status value', () => {
    const statuses = Object.values(RS);
    for (const status of statuses) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(VALID_TRANSITIONS, status),
        `Missing VALID_TRANSITIONS entry for status: ${status}`,
      );
    }
  });

  it('all target statuses are known values', () => {
    const known = new Set(Object.values(RS));
    for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const to of targets) {
        assert.ok(
          known.has(to as RS),
          `Unknown target "${to}" in VALID_TRANSITIONS["${from}"]`,
        );
      }
    }
  });
});
