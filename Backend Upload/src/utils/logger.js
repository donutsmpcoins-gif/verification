const winston = require('winston');
const config = require('../config');

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const stackStr = stack ? `\n${stack}` : '';
    return `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${message}${metaStr}${stackStr}`;
  })
);

const logger = winston.createLogger({
  level: config.server.nodeEnv === 'production' ? 'info' : 'debug',
  format: logFormat,
  defaultMeta: {},
  transports: [
    new winston.transports.Console({
      format: logFormat,
    }),
  ],
  // Don't exit on uncaught exceptions — let the process manager handle restarts
  exitOnError: false,
});

// Stream for morgan or other HTTP loggers if needed
logger.stream = {
  write: (message) => logger.info(message.trim()),
};

module.exports = logger;
