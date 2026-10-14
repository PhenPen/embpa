const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const invoices = db
    .prepare('SELECT * FROM invoices WHERE user_id = ?')
    .all(req.user.id);
  res.json(invoices);
});

router.post('/', (req, res) => {
  try {
    const { customer, amount } = req.body;

    if (!customer || !amount) {
      return res.status(400).send({ error: 'Customer and amount are required' });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).send({ error: 'Amount must be a positive number' });
    }

    const result = db
      .prepare(
        'INSERT INTO invoices (customer, amount, paid, user_id) VALUES (?, ?, 0, ?)'
      )
      .run(customer, amount, req.user.id);

    const newInvoice = db
      .prepare('SELECT * FROM invoices WHERE id = ?')
      .get(result.lastInsertRowid);

    res.status(201).json(newInvoice);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const invoiceId = parseInt(req.params.id, 10);

    if (isNaN(invoiceId)) {
      return res.status(400).send({ error: 'Invalid invoice id' });
    }

    const invoice = db
      .prepare('SELECT * FROM invoices WHERE id = ?')
      .get(invoiceId);

    // Same "not found" message for nonexistent OR other users' invoices
    if (!invoice || invoice.user_id !== req.user.id) {
      return res.status(404).send({ error: 'Invoice not found' });
    }

    if (invoice.paid) {
      return res.status(400).send({ error: 'Cannot delete a paid invoice' });
    }

    if (invoice.payment_intent_id) {
      return res
        .status(400)
        .send({ error: 'Cannot delete an invoice with a payment in progress' });
    }

    db.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: err.message });
  }
});

module.exports = router;
