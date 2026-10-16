/**
 * Value-Added Monetization & Multi-Year Historical Upgrade Radar Routes.
 *
 * - GET  /value-added/catalog          (List high-WTP order-bump & pre-exam add-on services)
 * - POST /value-added/id-photo-polish  (AI 2-inch standard exam ID photo spec check & backdrop polish)
 * - GET  /value-added/upgrade-radar    (Analyze historical registrations/archives for next-grade upgrade candidates)
 * - POST /value-added/upgrade-radar    (Evaluate custom historical dataset + store records for upgrade radar)
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  VALUE_ADDED_CATALOG,
  formatRmbYuan,
  validateAndPolishExamIdPhoto,
  evaluateHistoricalUpgradeRadar,
  type HistoricalStudentRecord,
} from '@musicexamaid/shared';

export async function valueAddedRoutes(app: FastifyInstance): Promise<void> {
  // 1. List value-added monetization catalog
  app.get('/value-added/catalog', async (_req, reply) => {
    const items = Object.values(VALUE_ADDED_CATALOG).map(spec => ({
      ...spec,
      price_yuan: formatRmbYuan(spec.price_fen),
      teacher_share_yuan: formatRmbYuan(spec.teacher_share_fen),
      platform_profit_yuan: formatRmbYuan(spec.platform_profit_fen),
    }));
    return reply.code(200).send({
      items,
    });
  });

  // 2. AI 2-Inch Standard Exam ID Photo Compliance & Backdrop Polish
  app.post(
    '/value-added/id-photo-polish',
    async (
      req: FastifyRequest<{
        Body: {
          learner_id?: string;
          name_cn?: string;
          id_number_or_last4?: string;
          backdrop_color?: 'white' | 'blue' | 'red';
          photo_base64?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const body = req.body ?? {};
      const learner = body.learner_id ? app.store.getLearner(body.learner_id) : undefined;
      const nameCn = body.name_cn || learner?.name_cn || '陈小乐';
      const idNumberOrLast4 = body.id_number_or_last4 || learner?.id_last4 || '9876';
      const backdropColor = body.backdrop_color || 'white';

      const rawBytes = body.photo_base64
        ? Buffer.from(body.photo_base64.replace(/^data:image\/\w+;base64,/, ''), 'base64')
        : Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(256, 0x11), 0xff, 0xd9]);

      const result = validateAndPolishExamIdPhoto({
        photoBytes: rawBytes,
        idNumberOrLast4,
        nameCn,
        backdropColor,
      });

      if (learner && result.compliant) {
        app.store.setLearnerPhoto(learner.id, rawBytes);
      }

      return reply.code(200).send(result);
    },
  );

  // 3. Historical Student Upgrade Radar (GET & POST)
  const handleUpgradeRadar = async (
    targetCycleId: string,
    teacherFilter?: string,
    extraHistorical: HistoricalStudentRecord[] = [],
  ) => {
    const storeRecords: HistoricalStudentRecord[] = app.store
      .listRegistrations()
      .map(r => {
        const learner = app.store.getLearner(r.learner_id);
        return {
          learner_id: r.learner_id,
          name_cn: learner?.name_cn || '未知考生',
          id_last4: learner?.id_last4 || '0000',
          guardian_phone: learner?.guardian_phone || '13800138000',
          subject_id: r.subject_id,
          level: r.level,
          cycle_id: r.cycle_id,
          teacher_id: r.teacher_id || 'tch_default',
        };
      });

    const archiveRecords: HistoricalStudentRecord[] = app.store
      .listArchives()
      .map(a => {
        const learner = app.store.getLearner(a.learner_id);
        return {
          learner_id: a.learner_id,
          name_cn: learner?.name_cn || '历史考生',
          id_last4: learner?.id_last4 || '0000',
          guardian_phone: learner?.guardian_phone || '13800138000',
          subject_id: a.subject_id,
          level: a.level,
          cycle_id: a.cycle_id || '2024-summer',
          teacher_id: 'tch_default',
        };
      });

    const combined = [...storeRecords, ...archiveRecords, ...extraHistorical];
    const report = evaluateHistoricalUpgradeRadar(
      combined,
      targetCycleId,
      app.store.listTeacherGradeRateCards(),
    );

    const filteredCandidates = teacherFilter
      ? report.candidates.filter(c => c.teacher_id === teacherFilter)
      : report.candidates;

    return {
      ...report,
      total_expected_exam_fee_yuan: formatRmbYuan(report.total_expected_exam_fee_fen),
      total_expected_concession_yuan: formatRmbYuan(report.total_expected_concession_fen),
      candidates: filteredCandidates.map(c => ({
        ...c,
        expected_exam_fee_yuan: formatRmbYuan(c.expected_exam_fee_fen),
        expected_concession_yuan: formatRmbYuan(c.expected_concession_fen),
      })),
    };
  };

  app.get(
    '/value-added/upgrade-radar',
    async (
      req: FastifyRequest<{
        Querystring: { target_cycle_id?: string; teacher_id?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const targetCycleId = req.query?.target_cycle_id || '2025-summer';
      const res = await handleUpgradeRadar(targetCycleId, req.query?.teacher_id);
      return reply.code(200).send(res);
    },
  );

  app.post(
    '/value-added/upgrade-radar',
    async (
      req: FastifyRequest<{
        Body: {
          target_cycle_id?: string;
          teacher_id?: string;
          historical_records?: HistoricalStudentRecord[];
        };
      }>,
      reply: FastifyReply,
    ) => {
      const body = req.body ?? {};
      const targetCycleId = body.target_cycle_id || '2025-summer';
      const res = await handleUpgradeRadar(
        targetCycleId,
        body.teacher_id,
        body.historical_records ?? [],
      );
      return reply.code(200).send(res);
    },
  );
}
