const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const config = require('../config');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// --- Helpers ---
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

// --- Routes ---
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send({ error: 'Email and password are required' });
    }

    if (typeof email !== 'string' || !validator.isEmail(email)) {
      return res.status(400).send({ error: 'Invalid email' });
    }

    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).send({ error: 'Password must be at least 8 characters' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(normalizedEmail);

    if (existing) {
      return res.status(400).send({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = db
      .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .run(normalizedEmail, passwordHash);

    const token = signToken(result.lastInsertRowid);
    setAuthCookie(res, token);

    res.status(201).json({
      user: { id: result.lastInsertRowid, email: normalizedEmail },
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(normalizedEmail);

    if (!user) {
      return res.status(401).send({ error: 'Invalid email or password' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).send({ error: 'Invalid email or password' });
    }

    const token = signToken(user.id);
    setAuthCookie(res, token);

    res.json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: err.message });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(config.cookieName);
  res.json({ success: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
