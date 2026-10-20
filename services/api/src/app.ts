import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health';
import { learnerRoutes } from './routes/learners';
import { registrationRoutes } from './routes/registrations';
import { archiveRoutes } from './routes/archives';
import { exportRoutes } from './routes/exports';
import { integrationRoutes } from './routes/integrations';
import { webAppRoutes } from './routes/web-app';
import { rpcRoutes } from './routes/rpc';
import { paymentConcessionRoutes } from './routes/payments-concessions';
import { officialSyncRoutes } from './routes/official-sync';
import { valueAddedRoutes } from './routes/value-added';
import { DomainRepository } from './store/repository';
import { assertProductionAuthConfig } from './auth/family-session';
import type { OfficialSyncOptions } from './routes/official-sync';

declare module 'fastify' {
  interface FastifyInstance {
    store: DomainRepository;
  }
}

export interface BuildAppOptions {
  logger?: boolean | { level: string };
  store?: DomainRepository;
  officialSync?: OfficialSyncOptions;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  assertProductionAuthConfig();
  const app = Fastify({
    logger: opts.logger ?? false,
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Mea-Session');
    if (req.method === 'OPTIONS') {
      return reply.code(204).send();
    }
  });

  app.decorate('store', opts.store ?? new DomainRepository());

  app.register(healthRoutes);
  app.register(learnerRoutes);
  app.register(registrationRoutes);
  app.register(archiveRoutes);
  app.register(exportRoutes);
  app.register(integrationRoutes);
  app.register(webAppRoutes);
  app.register(rpcRoutes);
  app.register(paymentConcessionRoutes);
  app.register(officialSyncRoutes, opts.officialSync ?? {});
  app.register(valueAddedRoutes);

  return app;
}


