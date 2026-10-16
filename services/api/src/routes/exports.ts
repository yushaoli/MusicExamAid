/**
 * Export job queue, SuperBatch Dedup Preflight, Template v2.1 Excel CSV & Portrait Photo ZIP bundle routes.
 *
 * - POST /exports/dedup-preflight
 * - POST /exports
 * - GET  /exports/:job_id/csv
 * - GET  /exports/:job_id/bundle.zip
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  RegistrationStatus,
  formatWeComExportAlert,
  serializeExportRowsToCsv,
  buildExportZipBundle,
  evaluateBatchDedup,
} from '@musicexamaid/shared';
import { dispatchWeComAlert } from './integrations';
import { minioClient } from '../store/minio';
import {
  persistLearnerToPostgres,
  persistRegistrationToPostgres,
  persistExportBatchToPostgres,
} from '../store/sql-sync';

interface CreateExportBody {
  cycle_id?: string;
  institution_id?: string;
  batch_type?: 'institution' | 'super';
  registration_ids?: string[];
  persist_db?: boolean;
  persist_s3?: boolean;
}

interface DedupPreflightBody {
  cycle_id?: string;
  registration_ids?: string[];
}

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/exports/dedup-preflight',
    async (
      req: FastifyRequest<{ Body: DedupPreflightBody }>,
      reply: FastifyReply,
    ) => {
      const cycleId = req.body?.cycle_id || '2025-summer';
      const requestedIds = req.body?.registration_ids
        ? new Set(req.body.registration_ids)
        : null;

      const candidates = app.store
        .listRegistrations()
        .filter(
          r =>
            r.status === RegistrationStatus.LOCKED &&
            r.cycle_id === cycleId &&
            (!requestedIds || requestedIds.has(r.id)),
        );

      const report = evaluateBatchDedup(candidates);
      return reply.code(200).send({
        cycle_id: cycleId,
        candidate_count: candidates.length,
        ready_to_export: report.conflict_ids.length === 0,
        ...report,
      });
    },
  );

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

      const liveDb =
        body.persist_db === true || process.env['ENABLE_LIVE_STORAGE'] === '1';
      const liveS3 =
        body.persist_s3 === true || process.env['ENABLE_LIVE_STORAGE'] === '1';

      let s3ExportUri: string | undefined;
      if (liveS3) {
        const photosByKey = { ...app.store.getPortraitPhotosByLast4() };
        for (const snap of batch.snapshots) {
          if (!photosByKey[snap.id_last4]) {
            const fromS3 = await minioClient
              .getObject(`photos/${snap.id_last4}_${snap.name_cn}.jpg`)
              .catch(() => null);
            if (fromS3) photosByKey[snap.id_last4] = fromS3;
          }
        }
        const { zipBuffer } = buildExportZipBundle({
          jobId: batch.job_id,
          cycleId: batch.cycle_id,
          snapshots: batch.snapshots,
          photosByKey,
        });
        const uploaded = await minioClient.putObject(
          `exports/${batch.cycle_id}/${batch.job_id}.zip`,
          zipBuffer,
          'application/zip',
        );
        s3ExportUri = uploaded.s3_uri;
      }

      if (liveDb) {
        for (const regId of batch.registration_ids) {
          const reg = app.store.getRegistration(regId);
          if (reg) {
            const learner = app.store.getLearner(reg.learner_id);
            if (learner) await persistLearnerToPostgres(learner);
            await persistRegistrationToPostgres(reg);
          }
        }
        await persistExportBatchToPostgres(
          batch,
          s3ExportUri ?? `exports/${batch.cycle_id}/${batch.job_id}.zip`,
        );
      }

      const wecomMsg = formatWeComExportAlert({
        jobId: batch.job_id,
        cycleId: batch.cycle_id,
        batchType: batch.batch_type,
        itemCount: batch.item_count,
      });
      const wecomDispatch = await dispatchWeComAlert(wecomMsg);

      return reply.code(202).send({
        job_id: batch.job_id,
        cycle_id: batch.cycle_id,
        institution_id: batch.institution_id,
        batch_type: batch.batch_type,
        registration_ids: batch.registration_ids,
        item_count: batch.item_count,
        status: batch.status,
        preview_rows: batch.preview_rows,
        photo_paths: batch.photo_paths,
        download_csv_url: `/exports/${batch.job_id}/csv`,
        download_zip_url: `/exports/${batch.job_id}/bundle.zip`,
        ...(s3ExportUri ? { s3_export_uri: s3ExportUri } : {}),
        ...(liveDb ? { pg_synced: true } : {}),
        notifications: {
          wecom: wecomDispatch.status,
        },
        queued_at: batch.queued_at,
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

  app.get(
    '/exports/:job_id/bundle.zip',
    async (
      req: FastifyRequest<{
        Params: { job_id: string };
        Querystring: { hydrate_s3?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const batch = app.store.getExportBatch(req.params.job_id);
      if (!batch) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: `Export job "${req.params.job_id}" not found`,
        });
      }

      const photosByKey = { ...app.store.getPortraitPhotosByLast4() };
      if (
        req.query?.hydrate_s3 === '1' ||
        process.env['ENABLE_LIVE_STORAGE'] === '1'
      ) {
        for (const snap of batch.snapshots) {
          if (!photosByKey[snap.id_last4]) {
            const fromS3 = await minioClient
              .getObject(`photos/${snap.id_last4}_${snap.name_cn}.jpg`)
              .catch(() => null);
            if (fromS3) photosByKey[snap.id_last4] = fromS3;
          }
        }
      }

      const { zipBuffer } = buildExportZipBundle({
        jobId: batch.job_id,
        cycleId: batch.cycle_id,
        snapshots: batch.snapshots,
        photosByKey,
      });

      return reply
        .header('Content-Type', 'application/zip')
        .header(
          'Content-Disposition',
          `attachment; filename="music_exam_bundle_${batch.cycle_id}_${batch.job_id}.zip"`,
        )
        .code(200)
        .send(zipBuffer);
    },
  );
}
