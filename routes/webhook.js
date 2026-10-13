const express = require('express');
const bodyParser = require('body-parser');
const Stripe = require('stripe');
const config = require('../config');
const db = require('../db');

const stripe = Stripe(config.stripeSecretKey);
const router = express.Router();

router.post('/', bodyParser.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      config.stripeWebhookSecret
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
});

module.exports = router;
