const logger = require('../../utils/logger');

/**
 * Global Express error handler.
 * Must have 4 parameters to be recognized as error middleware.
 */
function errorHandler(err, req, res, _next) {
  const requestId = req.headers['x-request-id'] || 'unknown';

  logger.error('Unhandled Express error', {
    requestId,
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
  });

  // Don't leak stack traces in production
  const isDev = process.env.NODE_ENV !== 'production';

  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: isDev ? err.message : 'An unexpected error occurred.',
    ...(isDev && { stack: err.stack }),
  });
}

module.exports = errorHandler;
