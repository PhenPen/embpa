const jwt = require('jsonwebtoken');
const config = require('./config');

function signToken(userId) {
  return jwt.sign({ userId }, config.jwtSecret, {
    expiresIn: config.jwtExpiry,
  });
}

function setAuthCookie(res, token) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: config.cookieMaxAgeMs,
  });
}

module.exports = { signToken, setAuthCookie };
