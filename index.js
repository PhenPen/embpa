require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const Stripe = require('stripe');
const path = require('path');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Fake invoice data (in-memory; resets on restart)
const invoices = [
  { id: 1, customer: 'Acme Supplies', amount: 2000, paid: false },
  { id: 2, customer: 'BuildCo', amount: 1500, paid: false },
  { id: 3, customer: 'Steel Works', amount: 3200, paid: false },
];

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

      const invoice = invoices.find((i) => i.id === invoiceId);
      if (invoice) {
        invoice.paid = true;
        console.log(`Invoice ${invoiceId} marked paid via webhook`);
      }
    }

    res.json({ received: true });
  }
);

// --- JSON PARSER FOR ALL OTHER ROUTES ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Get all invoices
app.get('/invoices', (req, res) => {
  res.json(invoices);
});

// Create a payment intent for an invoice
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { invoiceId } = req.body;
    const invoice = invoices.find((i) => i.id === invoiceId);

    if (!invoice) return res.status(404).send({ error: 'Invoice not found' });
    if (invoice.paid) return res.status(400).send({ error: 'Already paid' });

    // TEMPORARY HACK FOR TERMUX TESTING (Remove this line when you get to a PC)
    // invoice.paid = true; 

    const paymentIntent = await stripe.paymentIntents.create({
      amount: invoice.amount * 100, // Stripe uses cents
      currency: 'usd',
      metadata: { invoiceId: String(invoice.id) },
    });

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
