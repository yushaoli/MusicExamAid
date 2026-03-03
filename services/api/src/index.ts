import path from 'path';
import Fastify from 'fastify';
import { loadConfig } from '@musicexamaid/shared';
import { healthRoutes } from './routes/health';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Attempt to load from infra/.env.shared (two levels up from services/api/).
// Actual process.env values always take precedence.
const envFilePath = path.resolve(__dirname, '../../../infra/.env.shared');

let cfg: ReturnType<typeof loadConfig>;
try {
  cfg = loadConfig(envFilePath);
} catch (err) {
  console.error('[config] Failed to load environment configuration:', err);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = Fastify({
  logger: {
    level: cfg.NODE_ENV === 'production' ? 'info' : 'debug',
  },
});

app.register(healthRoutes);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const start = async () => {
  try {
    await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
