/**
 * Exam archive routes (Sprint 0 baseline stub).
 *
 * - POST /archives
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

interface CreateArchiveBody {
  learner_id?: string;
  cycle_id?: string;
  subject_id?: string;
  level?: number;
  result?: string;
  certificate_no?: string;
}

export async function archiveRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/archives',
    async (
      req: FastifyRequest<{ Body: CreateArchiveBody }>,
      reply: FastifyReply,
    ) => {
      const body = req.body ?? {};
      if (!body.learner_id || !body.subject_id || !body.level) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'learner_id, subject_id, and level are required',
        });
      }

      return reply.code(201).send({
        id: `arc_stub_${Date.now()}`,
        learner_id: body.learner_id,
        cycle_id: body.cycle_id ?? null,
        subject_id: body.subject_id,
        level: body.level,
        result: body.result ?? '通过',
        certificate_no: body.certificate_no ?? '',
        created_at: new Date().toISOString(),
      });
    },
  );
}
