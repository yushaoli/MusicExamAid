/**
 * Registration & Teacher Review routes (backed by DomainRepository).
 *
 * - POST /registrations
 * - GET  /registrations/:id
 * - PATCH /registrations/:id/status  (Teacher review / snapshot lock + WeCom/WeChat MP notify)
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  RegistrationStatus,
  canTransition,
  VALID_TRANSITIONS,
  formatWeComStatusAlert,
} from '@musicexamaid/shared';
import type { RegistrationStatusType } from '@musicexamaid/shared';
import { dispatchWeComAlert } from './integrations';

interface CreateRegistrationBody {
  learner_id?: string;
  institution_id?: string;
  cycle_id?: string;
  subject_id?: string;
  level?: number;
  exam_mode?: '现场' | '视频' | '音基';
  exam_site_id_optional?: string;
  repertoire?: string[];
}

interface TransitionStatusParams {
  id: string;
}

interface TransitionStatusBody {
  from_status?: RegistrationStatusType;
  to_status?: RegistrationStatusType;
  teacher_notes?: string;
}

const KNOWN_STATUSES = new Set<string>(Object.values(RegistrationStatus));

function isRegistrationStatus(val: unknown): val is RegistrationStatusType {
  return typeof val === 'string' && KNOWN_STATUSES.has(val);
}

export async function registrationRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/registrations',
    async (
      req: FastifyRequest<{ Body: CreateRegistrationBody }>,
      reply: FastifyReply,
    ) => {
      const body = req.body ?? {};
      if (!body.learner_id || !body.cycle_id || !body.subject_id || !body.level) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'learner_id, cycle_id, subject_id, and level are required',
        });
      }

      const reg = app.store.createRegistration({
        learner_id: body.learner_id,
        institution_id: body.institution_id ?? null,
        cycle_id: body.cycle_id,
        subject_id: body.subject_id,
        level: body.level,
        exam_mode: body.exam_mode ?? '现场',
        exam_site_id_optional: body.exam_site_id_optional,
        repertoire: body.repertoire ?? [],
      });

      return reply.code(201).send(reg);
    },
  );

  app.get(
    '/registrations/:id',
    async (
      req: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const reg = app.store.getRegistration(req.params.id);
      if (!reg) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: `Registration "${req.params.id}" not found`,
        });
      }
      return reply.code(200).send({
        ...reg,
        history: app.store.getStatusHistory(reg.id),
      });
    },
  );

  app.patch(
    '/registrations/:id/status',
    async (
      req: FastifyRequest<{
        Params: TransitionStatusParams;
        Body: TransitionStatusBody;
      }>,
      reply: FastifyReply,
    ) => {
      const { id } = req.params;
      const body = req.body ?? {};
      const existing = app.store.getRegistration(id);
      const fromStatus = existing
        ? existing.status
        : (body.from_status ?? RegistrationStatus.SUBMITTED);
      const toStatus = body.to_status;

      if (!isRegistrationStatus(fromStatus) || !isRegistrationStatus(toStatus)) {
        return reply.code(400).send({
          error: 'INVALID_STATUS_VALUE',
          message: `from_status and to_status must be one of: ${Array.from(KNOWN_STATUSES).join(', ')}`,
        });
      }

      if (!canTransition(fromStatus, toStatus)) {
        return reply.code(409).send({
          error: 'INVALID_STATUS_TRANSITION',
          message: `Cannot transition registration "${id}" from "${fromStatus}" to "${toStatus}"`,
          allowed_transitions: VALID_TRANSITIONS[fromStatus],
        });
      }

      const updated = app.store.transitionRegistration({
        id,
        from_status: fromStatus,
        to_status: toStatus,
        teacher_notes: body.teacher_notes,
      });

      const wecomMsg = formatWeComStatusAlert({
        registrationId: id,
        fromStatus,
        toStatus,
        teacherNotes: body.teacher_notes,
      });
      const wecomDispatch = await dispatchWeComAlert(wecomMsg);

      return reply.code(200).send({
        id: updated.id,
        from_status: fromStatus,
        status: updated.status,
        teacher_notes: updated.teacher_notes,
        missing_flags: updated.missing_flags,
        locked_at: updated.locked_at,
        has_snapshot: updated.snapshot_json !== null,
        notifications: {
          wecom: wecomDispatch.status,
          wechat_mp:
            toStatus === RegistrationStatus.NEEDS_CHANGE ||
            toStatus === RegistrationStatus.CONFIRMED ||
            toStatus === RegistrationStatus.LOCKED
              ? 'eligible'
              : 'skipped',
        },
        updated_at: updated.updated_at,
      });
    },
  );
}
