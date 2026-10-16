/**
 * Exam archive routes (backed by DomainRepository).
 *
 * - GET  /archives
 * - POST /archives
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resolveSubjectName } from '@musicexamaid/shared';

interface CreateArchiveBody {
  learner_id?: string;
  cycle_id?: string;
  subject_id?: string;
  level?: number;
  result?: string;
  certificate_no?: string;
}

export async function archiveRoutes(app: FastifyInstance): Promise<void> {
  app.get('/archives', async (_req: FastifyRequest, reply: FastifyReply) => {
    const items = app.store.listArchives().map(a => {
      const learner = app.store.getLearner(a.learner_id);
      return {
        ...a,
        learner_name_cn: learner?.name_cn ?? '未知学员',
        subject_name: resolveSubjectName(a.subject_id),
      };
    });
    return reply.code(200).send({ items });
  });

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

      const record = app.store.createArchive({
        learner_id: body.learner_id,
        cycle_id: body.cycle_id ?? null,
        subject_id: body.subject_id,
        level: Number(body.level),
        result: body.result ?? '通过',
        certificate_no: body.certificate_no ?? '',
      });

      return reply.code(201).send(record);
    },
  );
}
