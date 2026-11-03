-- Explicit ownership assertions. Legacy users/learners parent_user_id values are not evidence.
-- learner_id is text because the running domain repository uses identifiers such as lrn_*.
BEGIN;

CREATE TABLE parent_learner_grants (
  parent_openid VARCHAR(128) NOT NULL
    CHECK (parent_openid ~ '^[A-Za-z0-9_-]{1,128}$'),
  learner_id TEXT NOT NULL CHECK (length(learner_id) BETWEEN 1 AND 128),
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (parent_openid, learner_id)
);

CREATE INDEX parent_learner_grants_active_learner_idx
  ON parent_learner_grants (learner_id, parent_openid)
  WHERE revoked_at IS NULL;

COMMIT;
