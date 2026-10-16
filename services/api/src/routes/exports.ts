/**
 * Export job queue routes (backed by DomainRepository with Template v2.1 row preview).
 *
 * - POST /exports
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { formatWeComExportAlert } from '@musicexamaid/shared';
import { dispatchWeComAlert } from './integrations';

interface CreateExportBody {
  cycle_id?: string;
  institution_id?: string;
  batch_type?: 'institution' | 'super';
  registration_ids?: string[];
}

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/exports',
    async (
      req: FastifyRequest<{ Body: CreateExportBody }>,
      reply: FastifyReply,
    ) => {
      const body = req.body ?? {};
      if (
        !body.cycle_id ||
        !Array.isArray(body.registration_ids) ||
        body.registration_ids.length === 0
      ) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'cycle_id and a non-empty registration_ids array are required',
        });
      }

      const batch = app.store.createExportBatch({
        cycle_id: body.cycle_id,
        institution_id: body.institution_id ?? null,
        batch_type: body.batch_type ?? 'super',
        registration_ids: body.registration_ids,
      });

      const wecomMsg = formatWeComExportAlert({
        jobId: batch.job_id,
        cycleId: batch.cycle_id,
        batchType: batch.batch_type,
        itemCount: batch.item_count,
      });
      const wecomDispatch = await dispatchWeComAlert(wecomMsg);

      return reply.code(202).send({
        ...batch,
        notifications: {
          wecom: wecomDispatch.status,
        },
      });
    },
  );
}
