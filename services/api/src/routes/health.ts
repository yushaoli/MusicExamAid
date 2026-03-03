/**
 * GET /health
 *
 * Returns the API service status and stub dependency statuses.
 * Dependency checks (postgres, redis, s3) are stubs in Sprint-0;
 * they will be replaced with real connectivity probes in Sprint-1.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

interface DependencyStatus {
  status: 'ok' | 'error' | 'stub';
  latencyMs?: number;
  message?: string;
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  version: string;
  dependencies: {
    postgres: DependencyStatus;
    redis: DependencyStatus;
    s3: DependencyStatus;
  };
}

async function handleHealth(
  _req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body: HealthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '0.0.0',
    dependencies: {
      postgres: { status: 'stub', message: 'connectivity check not yet implemented' },
      redis: { status: 'stub', message: 'connectivity check not yet implemented' },
      s3: { status: 'stub', message: 'connectivity check not yet implemented' },
    },
  };
  reply.send(body);
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', handleHealth);
}
