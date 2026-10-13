require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const Stripe = require('stripe');
const path = require('path');
const db = require('./db');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// --- CONFIG FROM .env ---
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';
const COOKIE_NAME = process.env.COOKIE_NAME || 'auth_token';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const COOKIE_MAX_AGE_MS = parseInt(process.env.COOKIE_MAX_AGE_MS, 10) || 604800000;

// Safety check: fail fast if JWT_SECRET is missing
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set in .env');
  process.exit(1);
}

// --- WEBHOOK ROUTE (must come BEFORE express.json) ---
app.post(
  '/webhook',
  bodyParser.raw({ type: 'application/json' }),
  (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log('Webhook signature failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const invoiceId = parseInt(paymentIntent.metadata.invoiceId, 10);

      db.prepare('UPDATE invoices SET paid = 1 WHERE id = ?').run(invoiceId);
      console.log(`Invoice ${invoiceId} marked paid via webhook`);
    }

    res.json({ received: true });
  }
);

// --- MIDDLEWARE ---
app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- AUTH HELPERS ---
function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, {
    expiresIn: JWT_EXPIRY,
  });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

// --- requireAuth MIDDLEWARE ---
function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];

  if (!token) {
    return res.status(401).send({ error: 'Not authenticated' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
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

// --- AUTH ROUTES ---
app.post('/auth/register', async (req, res) => {
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

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(normalizedEmail);

    // Same message whether user doesn't exist OR password is wrong.
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

app.post('/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

app.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// --- CONFIG ROUTE ---
app.get('/config', (req, res) => {
  if (!process.env.STRIPE_PUBLISHABLE_KEY) {
    return res.status(500).send({ error: 'STRIPE_PUBLISHABLE_KEY not set' });
  }
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// --- INVOICE ROUTES (unprotected for now, protected in Stage A3) ---
app.get('/invoices', (req, res) => {
  const invoices = db.prepare('SELECT * FROM invoices').all();
  res.json(invoices);
});

app.post('/invoices', (req, res) => {
  try {
    const { customer, amount } = req.body;

    if (!customer || !amount) {
      return res.status(400).send({ error: 'Customer and amount are required' });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).send({ error: 'Amount must be a positive number' });
    }

    const result = db
      .prepare('INSERT INTO invoices (customer, amount, paid) VALUES (?, ?, 0)')
      .run(customer, amount);

    const newInvoice = db
      .prepare('SELECT * FROM invoices WHERE id = ?')
      .get(result.lastInsertRowid);

    res.status(201).json(newInvoice);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: err.message });
  }
});

// --- PAYMENT ROUTE (unprotected for now, protected in Stage A3) ---
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { invoiceId, idempotencyKey } = req.body;

    const checkAndReserve = db.transaction((id) => {
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);

      if (!invoice) throw new Error('Invoice not found');
      if (invoice.paid) throw new Error('Already paid');

      if (invoice.payment_intent_id && invoice.payment_intent_id !== 'PENDING') {
        return { invoice, existingIntentId: invoice.payment_intent_id };
      }

      if (invoice.payment_intent_id === 'PENDING') {
        throw new Error('Payment already in progress. Please wait.');
      }

      db.prepare('UPDATE invoices SET payment_intent_id = ? WHERE id = ?')
        .run('PENDING', id);

      return { invoice, existingIntentId: null };
    });

    const { invoice, existingIntentId } = checkAndReserve(invoiceId);

    if (existingIntentId) {
      const existingIntent = await stripe.paymentIntents.retrieve(existingIntentId);
      return res.send({
        clientSecret: existingIntent.client_secret,
        invoice,
      });
    }

    const stripeOptions = {};
    if (idempotencyKey) {
      stripeOptions.idempotencyKey = idempotencyKey;
    }

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: invoice.amount * 100,
        currency: 'usd',
        metadata: { invoiceId: String(invoice.id) },
      },
      stripeOptions
    );

    db.prepare('UPDATE invoices SET payment_intent_id = ? WHERE id = ?')
      .run(paymentIntent.id, invoice.id);

    res.send({
      clientSecret: paymentIntent.client_secret,
      invoice,
    });
  } catch (err) {
    console.error(err);

    if (req.body.invoiceId) {
      try {
        db.prepare(
          "UPDATE invoices SET payment_intent_id = NULL WHERE id = ? AND payment_intent_id = 'PENDING'"
        ).run(req.body.invoiceId);
      } catch (cleanupErr) {
        console.error('Failed to release reservation:', cleanupErr.message);
      }
    }

    res.status(400).send({ error: err.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
