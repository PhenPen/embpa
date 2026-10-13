require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const Stripe = require('stripe');
const path = require('path');
const db = require('./db');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/config', (req, res) => {
  if (!process.env.STRIPE_PUBLISHABLE_KEY) {
    return res.status(500).send({ error: 'STRIPE_PUBLISHABLE_KEY not set' });
  }
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

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

app.post('/create-payment-intent', async (req, res) => {
  try {
    const { invoiceId, idempotencyKey } = req.body;

    // --- STEP 1: Check-and-reserve inside a transaction ---
    const checkAndReserve = db.transaction((id) => {
      const invoice = db
        .prepare('SELECT * FROM invoices WHERE id = ?')
        .get(id);

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

    // --- STEP 2: If a PaymentIntent already exists, retrieve it ---
    if (existingIntentId) {
      const existingIntent = await stripe.paymentIntents.retrieve(existingIntentId);
      return res.send({
        clientSecret: existingIntent.client_secret,
        invoice,
      });
    }

    // --- STEP 3: Create a new PaymentIntent (async, outside the transaction) ---
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

    // --- STEP 4: Save the real PaymentIntent ID ---
    db.prepare('UPDATE invoices SET payment_intent_id = ? WHERE id = ?')
      .run(paymentIntent.id, invoice.id);

    res.send({
      clientSecret: paymentIntent.client_secret,
      invoice,
    });
  } catch (err) {
    console.error(err);

    // Release the reservation if we failed
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
