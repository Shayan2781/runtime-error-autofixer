import express from 'express';
import cors from 'cors';
import pino from 'pino';
import { loadConfig } from './config.js';
import { initDatabase } from './db/index.js';
import { ProjectDAO } from './db/projects.js';
import { ErrorEventDAO } from './db/errorEvents.js';
import { SourceMapDAO } from './db/sourceMaps.js';
import { ErrorGroupDAO } from './db/errorGroups.js';
import { AnalysisDAO } from './db/analyses.js';
import { PRDAO } from './db/prs.js';
import { createErrorRoutes } from './routes/errors.js';
import { createSourceMapRoutes } from './routes/sourcemaps.js';
import { createAnalyzeRoutes } from './routes/analyze.js';
import { createPRRoutes } from './routes/pr.js';

const config = loadConfig();

const logger = pino({
  level: config.logLevel,
  transport:
    config.nodeEnv === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
          },
        }
      : undefined,
});

const db = initDatabase(config.databaseUrl, config.storageDir);
logger.info('Database initialized');

const projectDAO = new ProjectDAO(db);
const errorEventDAO = new ErrorEventDAO(db);
const sourceMapDAO = new SourceMapDAO(db);
const errorGroupDAO = new ErrorGroupDAO(db);
const analysisDAO = new AnalysisDAO(db);
const prDAO = new PRDAO(db);

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  logger.info({ method: req.method, path: req.path }, 'Incoming request');
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/v1/errors', createErrorRoutes(db, projectDAO, errorEventDAO, sourceMapDAO, errorGroupDAO, config, logger));
app.use('/api/v1/sourcemaps', createSourceMapRoutes(projectDAO, sourceMapDAO, config, logger));
app.use('/api/v1/analyze', createAnalyzeRoutes(errorEventDAO, errorGroupDAO, sourceMapDAO, analysisDAO, projectDAO, config, logger));
app.use('/api/v1/pr', createPRRoutes(analysisDAO, prDAO, projectDAO, errorEventDAO, sourceMapDAO, config, logger));

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, nodeEnv: config.nodeEnv }, 'Server started');
});

function shutdown() {
  logger.info('Shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    db.close();
    logger.info('Database closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => {
  logger.info('SIGTERM received');
  shutdown();
});

process.on('SIGINT', () => {
  logger.info('SIGINT received');
  shutdown();
});
