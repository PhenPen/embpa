const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const config = require('./config');
const webhookRouter = require('./routes/webhook');
const authRouter = require('./routes/auth');
const invoicesRouter = require('./routes/invoices');
const paymentsRouter = require('./routes/payments');

const app = express();

// --- WEBHOOK FIRST (needs raw body, before express.json) ---
app.use('/webhook', webhookRouter);

// --- GLOBAL MIDDLEWARE ---
app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- ROUTES ---
app.use('/auth', authRouter);
app.use('/invoices', invoicesRouter);
app.use('/', paymentsRouter);

app.get('/config', (req, res) => {
  if (!config.stripePublishableKey) {
    return res.status(500).send({ error: 'STRIPE_PUBLISHABLE_KEY not set' });
  }
  res.json({ publishableKey: config.stripePublishableKey });
});

// --- START ---
app.listen(config.port, () => console.log(`Server running on port ${config.port}`));
