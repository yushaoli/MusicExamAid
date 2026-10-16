/**
 * GET /health
 *
 * Returns the API service status and dependency statuses.
 * Pass `?live=1` (or set `HEALTH_LIVE_PROBE=1`) to run live TCP connectivity
 * probes against `POSTGRES_URL`, `REDIS_URL`, and `S3_ENDPOINT` (`ubtxiaomi.ts.xgar.com.cn`).
 */

import * as net from 'net';
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

function probeTcpUrl(rawUrl: string, defaultPort: number, timeoutMs = 1500): Promise<DependencyStatus> {
  return new Promise(resolve => {
    let host = 'ubtxiaomi.ts.xgar.com.cn';
    let port = defaultPort;
    try {
      const parsed = new URL(rawUrl);
      host = parsed.hostname || host;
      port = parsed.port ? parseInt(parsed.port, 10) : defaultPort;
    } catch {
      // fallback to defaults
    }

    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (res: DependencyStatus) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(res);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      finish({ status: 'ok', latencyMs: Date.now() - start });
    });
    socket.once('timeout', () => {
      finish({
        status: 'error',
        latencyMs: Date.now() - start,
        message: `timeout connecting to ${host}:${port}`,
      });
    });
    socket.once('error', err => {
      finish({
        status: 'error',
        latencyMs: Date.now() - start,
        message: err.message,
      });
    });

    socket.connect(port, host);
  });
}

async function handleHealth(
  req: FastifyRequest<{ Querystring: { live?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const runLive =
    req.query?.live === '1' || process.env.HEALTH_LIVE_PROBE === '1';

  let dependencies: HealthResponse['dependencies'];

  if (runLive) {
    const [postgres, redis, s3] = await Promise.all([
      probeTcpUrl(
        process.env.POSTGRES_URL || 'postgresql://ubtxiaomi.ts.xgar.com.cn:55432',
        55432,
      ),
      probeTcpUrl(
        process.env.REDIS_URL || 'redis://ubtxiaomi.ts.xgar.com.cn:63790',
        63790,
      ),
      probeTcpUrl(
        process.env.S3_ENDPOINT || 'http://ubtxiaomi.ts.xgar.com.cn:9010',
        9010,
      ),
    ]);
    dependencies = { postgres, redis, s3 };
  } else {
    dependencies = {
      postgres: { status: 'stub', message: 'pass ?live=1 for TCP probe' },
      redis: { status: 'stub', message: 'pass ?live=1 for TCP probe' },
      s3: { status: 'stub', message: 'pass ?live=1 for TCP probe' },
    };
  }

  const anyError = Object.values(dependencies).some(d => d.status === 'error');
  const body: HealthResponse = {
    status: anyError ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '0.0.0',
    dependencies,
  };
  reply.send(body);
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', handleHealth);
}
