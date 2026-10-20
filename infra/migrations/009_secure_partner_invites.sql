-- Correct the already-applied 008 token format without rewriting migration history.
BEGIN;

UPDATE kjzx_partner_agents
SET invite_token = 't_inv_' || agent_id::text || '_' || encode(gen_random_bytes(16), 'hex')
WHERE agent_id <> 999
  AND (invite_token IS NULL OR invite_token !~ '^t_inv_[0-9]+_[0-9a-f]{32}$');

COMMIT;
