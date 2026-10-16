/**
 * Export job queue & Template v2.1 Excel CSV download routes.
 *
 * - POST /exports
 * - GET  /exports/:job_id/csv
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  formatWeComExportAlert,
  serializeExportRowsToCsv,
} from '@musicexamaid/shared';
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
        download_csv_url: `/exports/${batch.job_id}/csv`,
        notifications: {
          wecom: wecomDispatch.status,
        },
      });
    },
  );

  app.get(
    '/exports/:job_id/csv',
    async (
      req: FastifyRequest<{ Params: { job_id: string } }>,
      reply: FastifyReply,
    ) => {
      const batch = app.store.getExportBatch(req.params.job_id);
      if (!batch) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: `Export job "${req.params.job_id}" not found`,
        });
      }

      const csv = serializeExportRowsToCsv(batch.preview_rows);
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="music_exam_export_${batch.cycle_id}_${batch.job_id}.csv"`,
        )
        .code(200)
        .send(csv);
    },
  );
}
