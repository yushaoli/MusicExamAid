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
import { DomainRepository } from './store/repository';

declare module 'fastify' {
  interface FastifyInstance {
    store: DomainRepository;
  }
}

export interface BuildAppOptions {
  logger?: boolean | { level: string };
  store?: DomainRepository;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ?? false,
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

  return app;
}

