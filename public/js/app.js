// Main app: Stripe setup, invoices list, payment modal, create modal, delete.

(function () {
  let stripe;
  let stripeInitialized = false;
  let cardNumber, cardExpiry, cardCvc, postalCode;

  let currentInvoiceId = null;
  let currentIdempotencyKey = null;

  // --- Stripe setup ---
  async function initStripe() {
    if (stripeInitialized) return;

    const res = await apiFetch('/config');
    const { publishableKey } = await res.json();

    stripe = Stripe(publishableKey);
    const elements = stripe.elements();

    cardNumber = elements.create('cardNumber');
    cardExpiry = elements.create('cardExpiry');
    cardCvc = elements.create('cardCvc');
    postalCode = elements.create('postalCode');

    cardNumber.mount('#card-number');
    cardExpiry.mount('#card-expiry');
    cardCvc.mount('#card-cvc');
    postalCode.mount('#postal-code');

    stripeInitialized = true;
  }

  // --- Invoices ---
  async function loadInvoices() {
    const res = await apiFetch('/invoices');

    const invoices = await res.json();
    const container = document.getElementById('invoices');
    container.classList.remove('loading');
    container.innerHTML = '';

    if (invoices.length === 0) {
      renderSampleInvoice(container);
      return;
    }

    invoices.forEach((inv) => {
      container.appendChild(renderInvoiceRow(inv));
    });
  }

  function renderInvoiceRow(inv) {
    const div = document.createElement('div');
    div.className = 'invoice';

    const label = document.createElement('span');
    label.textContent = `${inv.customer} — $${(inv.amount / 1).toFixed(2)}`;
    div.appendChild(label);

    if (inv.paid) {
      const paid = document.createElement('span');
      paid.className = 'paid';
      paid.textContent = 'Paid';
      div.appendChild(paid);
    } else {
      const actions = document.createElement('div');
      actions.className = 'invoice-actions';

      const payBtn = document.createElement('button');
      payBtn.textContent = 'Pay';
      payBtn.onclick = () => openPaymentModal(inv.id);
      actions.appendChild(payBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-icon';
      delBtn.textContent = '×';
      delBtn.title = 'Delete invoice';
      delBtn.onclick = () => showDeleteConfirm(div, inv);
      actions.appendChild(delBtn);

      div.appendChild(actions);
    }

    return div;
  }

  function renderSampleInvoice(container) {
    const div = document.createElement('div');
    div.className = 'invoice sample';

    const label = document.createElement('span');
    label.innerHTML = 'Sample Supplies Co. — $1,500.00 <span class="badge">SAMPLE</span>';
    div.appendChild(label);

    const btn = document.createElement('button');
    btn.textContent = 'Pay';
    btn.disabled = true;
    div.appendChild(btn);

    container.appendChild(div);

    const hint = document.createElement('p');
    hint.className = 'sample-hint';
    hint.textContent = 'This is what an invoice looks like. Click "+ Add Invoice" to create your own.';
    container.appendChild(hint);
  }

  // --- Delete confirmation (inline, no modal) ---
  function showDeleteConfirm(div, inv) {
    div.innerHTML = '';
    div.classList.add('confirming');

    const msg = document.createElement('span');
    msg.textContent = `Delete "${inv.customer}"?`;
    div.appendChild(msg);

    const actions = document.createElement('div');
    actions.className = 'invoice-actions';

    const yesBtn = document.createElement('button');
    yesBtn.className = 'btn-danger';
    yesBtn.textContent = 'Yes';
    yesBtn.onclick = () => deleteInvoice(inv.id);

    const noBtn = document.createElement('button');
    noBtn.className = 'btn-secondary';
    noBtn.textContent = 'No';
    noBtn.onclick = () => {
      const fresh = renderInvoiceRow(inv);
      div.replaceWith(fresh);
    };

    actions.appendChild(yesBtn);
    actions.appendChild(noBtn);
    div.appendChild(actions);
  }

  async function deleteInvoice(id) {
    try {
      const res = await apiFetch(`/invoices/${id}`, { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Delete failed');

      loadInvoices();
    } catch (err) {
      if (err.message !== 'Session expired') {
        console.error(err);
        loadInvoices();
      }
    }
  }

  // --- Payment modal ---
  function openPaymentModal(invoiceId) {
    currentInvoiceId = invoiceId;

    const storageKey = `idempotency_key_${invoiceId}`;
    let storedKey = sessionStorage.getItem(storageKey);

    if (!storedKey) {
      storedKey = crypto.randomUUID();
      sessionStorage.setItem(storageKey, storedKey);
    }

    currentIdempotencyKey = storedKey;

    document.getElementById('payment-modal').classList.add('open');
    document.getElementById('payment-form').style.display = 'block';
    document.getElementById('payment-success').style.display = 'none';
    document.getElementById('card-errors').textContent = '';

    cardNumber.clear();
    cardExpiry.clear();
    cardCvc.clear();
    postalCode.clear();
  }

  function closePaymentModal() {
    document.getElementById('payment-modal').classList.remove('open');
  }

  async function handlePayment() {
    const submitBtn = document.getElementById('submit-payment');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';

    try {
      const res = await apiFetch('/create-payment-intent', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId: currentInvoiceId,
          idempotencyKey: currentIdempotencyKey,
        }),
      });

      const { clientSecret, error } = await res.json();
      if (error) throw new Error(error);

      const { error: stripeError } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardNumber,
          billing_details: { name: 'Demo User' },
        },
      });

      if (stripeError) throw new Error(stripeError.message);

      sessionStorage.removeItem(`idempotency_key_${currentInvoiceId}`);

      document.getElementById('payment-form').style.display = 'none';
      document.getElementById('payment-success').style.display = 'block';

      setTimeout(() => {
        closePaymentModal();
        loadInvoices();
      }, 2000);
    } catch (err) {
      if (err.message !== 'Session expired') {
        document.getElementById('card-errors').textContent = err.message;
      }
      submitBtn.disabled = false;
      submitBtn.textContent = 'Pay Now';
    }
  }

  // --- Create invoice modal ---
  function openCreateModal() {
    document.getElementById('new-customer').value = '';
    document.getElementById('new-amount').value = '';
    document.getElementById('create-error').textContent = '';
    document.getElementById('create-modal').classList.add('open');
  }

  function closeCreateModal() {
    document.getElementById('create-modal').classList.remove('open');
  }

  async function handleCreateInvoice() {
    const customer = document.getElementById('new-customer').value.trim();
    const amountRaw = document.getElementById('new-amount').value;
    const amount = parseInt(amountRaw, 10);
    const errorDiv = document.getElementById('create-error');
    errorDiv.textContent = '';

    if (!customer) {
      errorDiv.textContent = 'Customer name is required';
      return;
    }
    if (!amountRaw || isNaN(amount) || amount <= 0) {
      errorDiv.textContent = 'Amount must be a positive number';
      return;
    }

    try {
      const res = await apiFetch('/invoices', {
        method: 'POST',
        body: JSON.stringify({ customer, amount }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Create failed');

      closeCreateModal();
      loadInvoices();
    } catch (err) {
      if (err.message !== 'Session expired') {
        errorDiv.textContent = err.message;
      }
    }
  }

  // --- Start app (called after successful auth) ---
  async function start(user) {
    document.getElementById('app-screen').style.display = 'block';
    document.getElementById('user-email').textContent = user.email;

    await initStripe();
    await loadInvoices();
  }

  // --- Event listeners ---
  document.getElementById('add-invoice-btn').onclick = openCreateModal;
  document.getElementById('submit-invoice').onclick = handleCreateInvoice;
  document.getElementById('cancel-invoice').onclick = closeCreateModal;

  document.getElementById('submit-payment').onclick = handlePayment;
  document.getElementById('cancel-payment').onclick = closePaymentModal;

  document.getElementById('logout-btn').onclick = async () => {
    await fetch('/auth/logout', { method: 'POST' });
    location.reload();
  };

  // --- Public API ---
  window.App = {
    start,
    loadInvoices,
  };
})();
