const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('../utils/logger');
const errorHandler = require('./middleware/errorHandler');
const oauthRoutes = require('./routes/oauth');
const healthRoutes = require('./routes/health');

function createServer() {
  const app = express();

  // ========================
  // MIDDLEWARE
  // ========================

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://cdn.discordapp.com'],
      },
    },
  }));

  // CORS — restrict in production
  app.use(cors({
    origin: config.server.nodeEnv === 'production'
      ? [config.server.baseUrl]
      : '*',
    credentials: true,
  }));

  // Body parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Rate limiting for OAuth routes
  const oauthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // 30 OAuth attempts per IP per window
    message: { error: 'Too many verification attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // General rate limiting
  const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use(generalLimiter);

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.debug('HTTP Request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
      });
    });
    next();
  });

  // ========================
  // ROUTES
  // ========================

  app.use('/api/oauth', oauthLimiter, oauthRoutes);
  app.use('/health', healthRoutes);

  // Root route
  app.get('/', (req, res) => {
    res.json({
      name: 'Discord Verification System',
      status: 'operational',
      version: '1.0.0',
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

/**
 * Start the Express server.
 */
function startServer() {
  const app = createServer();
  const port = config.server.port;

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      logger.info(`Express server listening on port ${port}`, {
        baseUrl: config.server.baseUrl,
        callbackUrl: config.oauth.redirectUri,
        env: config.server.nodeEnv,
      });
      resolve(server);
    });

    // Graceful shutdown handling
    server.on('close', () => {
      logger.info('Express server closed');
    });
  });
}

module.exports = { createServer, startServer };
