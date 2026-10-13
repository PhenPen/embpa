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

// --- JSON PARSER FOR ALL OTHER ROUTES ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Get all invoices
app.get('/invoices', (req, res) => {
  const invoices = db.prepare('SELECT * FROM invoices').all();
  res.json(invoices);
});

// Create a payment intent for an invoice
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { invoiceId, idempotencyKey } = req.body;

    const invoice = db
      .prepare('SELECT * FROM invoices WHERE id = ?')
      .get(invoiceId);

    if (!invoice) return res.status(404).send({ error: 'Invoice not found' });
    if (invoice.paid) return res.status(400).send({ error: 'Already paid' });

    // Build the options object for Stripe
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

    res.send({
      clientSecret: paymentIntent.client_secret,
      invoice,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: err.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
