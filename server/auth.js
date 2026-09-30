'use strict';

/**
 * Simple admin authentication middleware.
 * Checks X-Admin-Token header against ADMIN_TOKEN env var.
 */
function requireAdmin(req, res, next) {
  const adminToken = process.env.ADMIN_TOKEN;
  
  if (!adminToken) {
    return res.status(500).json({ error: 'Admin authentication not configured' });
  }
  
  const providedToken = req.headers['x-admin-token'];
  
  if (!providedToken || providedToken !== adminToken) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  next();
}

module.exports = { requireAdmin };
