import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { query as dbQuery } from './db.js';
import authRoutes from './routes/auth.routes.js';
import kycRoutes from './routes/kyc.routes.js';
import { notFound, errorHandler } from './middleware/error.js';
import webhookRoutes from './routes/webhook.routes.js';
import escrowRoutes from './routes/escrow.routes.js';
import adminRoutes from './routes/admin.routes.js';

fs.mkdirSync(config.uploads.dir, { recursive: true });

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

app.use('/uploads', express.static(path.resolve(config.uploads.dir)));
app.use(express.static(path.resolve('public')));

app.get('/health', (req, res) =>
  res.json({ ok: true, env: config.nodeEnv, apiPort: config.port }));

app.get('/health/db', async (_req, res) => {
  try {
    const { rows } = await dbQuery('SELECT current_database() AS database');
    return res.json({ ok: true, database: rows[0].database, dbPort: config.db.port });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      error: 'Database connection failed',
      ...(config.nodeEnv === 'development' ? { detail: err.message } : {}),
    });
  }
});

app.get('/', (req, res) => {res.send("Welcome users")})

app.use('/api/auth', authRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/escrow', escrowRoutes);
app.use('/api/admin', adminRoutes);


app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`RentSafe API listening at http://localhost:${config.port}`);
  console.log(`PostgreSQL target: ${config.db.host}:${config.db.port}/${config.db.name}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Stop the process using it or set PORT to another free port.`);
  } else {
    console.error('[server] Failed to start:', err);
  }
  process.exitCode = 1;
});