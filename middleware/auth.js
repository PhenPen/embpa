const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { signToken, setAuthCookie } = require('../auth-helpers');

// Refresh the token if it's older than this. 1 day (out of 7) is a good
// balance — refresh often enough that active users never hit expiry,
// rarely enough that we're not re-signing on every request.
const REFRESH_THRESHOLD_SECONDS = 24 * 60 * 60;

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

    // Sliding expiry: if the token is getting old, issue a fresh one.
    const tokenAgeSeconds = Math.floor(Date.now() / 1000) - decoded.iat;
    if (tokenAgeSeconds > REFRESH_THRESHOLD_SECONDS) {
      const newToken = signToken(user.id);
      setAuthCookie(res, newToken);
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).send({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth };
