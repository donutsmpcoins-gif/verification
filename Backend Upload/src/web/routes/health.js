const { Router } = require('express');
const db = require('../../database/pool');
const userQueries = require('../../database/queries/users');

const router = Router();

/**
 * GET /health
 * Basic health check endpoint for Render and monitoring.
 */
router.get('/', async (req, res) => {
  const checks = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: false,
  };

  try {
    await db.query('SELECT 1');
    checks.database = true;
  } catch {
    checks.status = 'degraded';
    checks.database = false;
  }

  const statusCode = checks.database ? 200 : 503;
  return res.status(statusCode).json(checks);
});

/**
 * GET /health/stats
 * Returns verification stats.
 */
router.get('/stats', async (req, res) => {
  try {
    const count = await userQueries.countVerifiedUsers();
    return res.json({
      verifiedUsers: count,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
