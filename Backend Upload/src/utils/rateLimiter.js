const logger = require('../utils/logger');

/**
 * Async sleep utility.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rate limiter for controlling request throughput.
 * Uses a token-bucket-like approach with configurable concurrency.
 */
class RateLimiter {
  constructor({ requestsPerSecond = 5, burstSize = 1 } = {}) {
    this.minInterval = Math.ceil(1000 / requestsPerSecond);
    this.burstSize = burstSize;
    this.lastRequestTime = 0;
    this.queue = [];
    this.processing = false;
  }

  /**
   * Wait until it's safe to make the next request.
   */
  async acquire() {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this._process();
    });
  }

  async _process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      const waitTime = Math.max(0, this.minInterval - elapsed);

      if (waitTime > 0) {
        await sleep(waitTime);
      }

      this.lastRequestTime = Date.now();
      const resolve = this.queue.shift();
      resolve();
    }

    this.processing = false;
  }
}

/**
 * Execute an async function with exponential backoff retry.
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Retry options
 * @returns {Promise<*>}
 */
async function retryWithBackoff(fn, {
  maxAttempts = 3,
  baseDelay = 1000,
  maxDelay = 30000,
  factor = 2,
  onRetry = null,
  retryOn = () => true,
} = {}) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts || !retryOn(err)) {
        throw err;
      }

      const delay = Math.min(baseDelay * Math.pow(factor, attempt - 1), maxDelay);
      const jitter = delay * (0.5 + Math.random() * 0.5); // Add jitter

      logger.warn('Retrying after error', {
        attempt,
        maxAttempts,
        delay: Math.round(jitter),
        error: err.message,
      });

      if (onRetry) {
        onRetry(err, attempt, jitter);
      }

      await sleep(jitter);
    }
  }

  throw lastError;
}

module.exports = {
  sleep,
  RateLimiter,
  retryWithBackoff,
};
