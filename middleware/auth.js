const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

function requireAuth(req, res, next) {
  const token = req.cookies[config.cookieName];

  if (!token) {
    return res.status(401).send({ error: 'Not authenticated' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = db
      .prepare('SELECT id, email FROM users WHERE id = ?')
      .get(decoded.userId);

    if (!user) {
      return res.status(401).send({ error: 'User no longer exists' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).send({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth };
