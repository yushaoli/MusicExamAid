/**
 * Learner profile routes (backed by DomainRepository with AES-256-GCM ID encryption).
 *
 * - GET  /learners
 * - POST /learners
 * - GET  /learners/:id
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { StoredLearner } from '../store/repository';

interface CreateLearnerBody {
  name_cn?: string;
  name_en_optional?: string;
  gender?: '男' | '女';
  dob?: string;
  nationality?: string;
  ethnicity_optional?: string;
  id_type?: string;
  id_number?: string;
  guardian_phone?: string;
  mailing_address_optional?: string;
  recipient_name_optional?: string;
  recipient_phone_optional?: string;
  has_portrait_photo?: boolean;
}

function toPublicLearner(learner: StoredLearner) {
  return {
    id: learner.id,
    name_cn: learner.name_cn,
    name_en_optional: learner.name_en_optional,
    gender: learner.gender,
    dob: learner.dob,
    nationality: learner.nationality,
    id_type: learner.id_type,
    id_last4: learner.id_last4,
    guardian_phone: learner.guardian_phone,
    has_portrait_photo: learner.has_portrait_photo,
    created_at: learner.created_at,
    updated_at: learner.updated_at,
  };
}

export async function learnerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/learners', async (_req: FastifyRequest, reply: FastifyReply) => {
    const items = app.store.listLearners().map(toPublicLearner);
    return reply.code(200).send({ items });
  });

  app.post(
    '/learners',
    async (
      req: FastifyRequest<{ Body: CreateLearnerBody }>,
      reply: FastifyReply,
    ) => {
      const body = req.body ?? {};
      if (
        !body.name_cn ||
        !body.gender ||
        !body.dob ||
        !body.id_type ||
        !body.id_number ||
        !body.guardian_phone
      ) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message:
            'name_cn, gender, dob, id_type, id_number, and guardian_phone are required',
        });
      }

      const learner = app.store.createLearner({
        name_cn: body.name_cn,
        name_en_optional: body.name_en_optional,
        gender: body.gender,
        dob: body.dob,
        nationality: body.nationality,
        ethnicity_optional: body.ethnicity_optional,
        id_type: body.id_type,
        id_number: body.id_number,
        guardian_phone: body.guardian_phone,
        mailing_address_optional: body.mailing_address_optional,
        recipient_name_optional: body.recipient_name_optional,
        recipient_phone_optional: body.recipient_phone_optional,
        has_portrait_photo: body.has_portrait_photo,
      });

      return reply.code(201).send(toPublicLearner(learner));
    },
  );

  app.get(
    '/learners/:id',
    async (
      req: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const learner = app.store.getLearner(req.params.id);
      if (!learner) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: `Learner "${req.params.id}" not found`,
        });
      }

      return reply.code(200).send(toPublicLearner(learner));
    },
  );
}
