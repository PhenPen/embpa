const express = require('express');
const Stripe = require('stripe');
const config = require('../config');
const db = require('../db');

const stripe = Stripe(config.stripeSecretKey);
const router = express.Router();

router.post('/create-payment-intent', async (req, res) => {
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

module.exports = router;
