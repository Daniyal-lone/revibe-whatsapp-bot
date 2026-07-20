const state = {
  token: localStorage.getItem('revibe_token'),
  role: localStorage.getItem('revibe_role') || 'staff',
  staff: [],
  services: [],
  selectedServiceId: ''
};

const statusBanner = document.querySelector('#statusBanner');
const visitForm = document.querySelector('#visitForm');
const staffSelect = document.querySelector('#staffSelect');
const serviceSearch = document.querySelector('#serviceSearch');
const serviceOptions = document.querySelector('#serviceOptions');
const serviceId = document.querySelector('#serviceId');
const amountPaid = document.querySelector('#amountPaid');
const visitDate = document.querySelector('#visitDate');

function setStatus(message, isError = false) {
  statusBanner.textContent = message;
  statusBanner.classList.toggle('error', isError);
}

function money(value) {
  return `Rs. ${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${state.token}`
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(state.token ? authHeaders() : { 'Content-Type': 'application/json' })
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function setToday() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  visitDate.value = now.toISOString().slice(0, 16);
}

function serviceLabel(service) {
  return `${service.category || 'Service'} - ${service.name} - ${money(service.price)}`;
}

function serviceMatches(search = '') {
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return state.services
    .filter((service) => {
      const haystack = `${service.name} ${service.category} ${service.price}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    })
    .slice(0, 20);
}

function renderServiceOptions(search = '') {
  const matches = serviceMatches(search);
  serviceOptions.innerHTML = matches
    .map((service) => `
      <button class="service-option" type="button" data-service-id="${service.id}">
        <strong>${service.name}</strong>
        <span>${service.category || 'Service'} | ${money(service.price)}</span>
      </button>
    `)
    .join('') || '<div class="muted">No matching service.</div>';
  serviceOptions.classList.toggle('open', Boolean(search.trim()));

  document.querySelectorAll('[data-service-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const selected = state.services.find((service) => service.id === button.dataset.serviceId);
      selectService(selected);
      serviceOptions.classList.remove('open');
    });
  });
}

function selectService(selected) {
  if (!selected) return;
  state.selectedServiceId = selected.id;
  serviceId.value = selected.id;
  serviceSearch.value = serviceLabel(selected);
  amountPaid.value = selected.price;
}

function renderBootstrap() {
  staffSelect.innerHTML = state.staff
    .map((person) => `<option value="${person.id}">${person.name} - ${person.role}</option>`)
    .join('');

  renderServiceOptions();
  if (state.services[0]) {
    selectService(state.services[0]);
  }
}

async function loadBootstrap() {
  if (!state.token) return;
  const data = await api('/api/bootstrap');
  state.staff = data.staff;
  state.services = data.services;
  renderBootstrap();
  document.querySelectorAll('.owner-only').forEach((el) => {
    el.style.display = ['owner', 'developer'].includes(state.role) ? '' : 'none';
  });
  setStatus(`Logged in as ${state.role}. Ready.`);
  await loadPrevious();
}

document.querySelector('#loginButton').addEventListener('click', async () => {
  try {
    const role = document.querySelector('#roleSelect').value;
    const pin = document.querySelector('#pinInput').value;
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ role, pin })
    });
    state.token = data.token;
    state.role = data.role;
    localStorage.setItem('revibe_token', state.token);
    localStorage.setItem('revibe_role', state.role);
    await loadBootstrap();
    if (['owner', 'developer'].includes(state.role)) {
      await showScreen('dashboard');
    }
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.querySelector('#logoutButton').addEventListener('click', () => {
  localStorage.removeItem('revibe_token');
  localStorage.removeItem('revibe_role');
  state.token = null;
  state.role = 'staff';
  document.querySelectorAll('.owner-only').forEach((el) => {
    el.style.display = 'none';
  });
  setStatus('Logged out. Enter PIN to continue.');
});

document.querySelectorAll('.nav-button').forEach((button) => {
  button.addEventListener('click', async () => {
    if (button.classList.contains('owner-only') && !['owner', 'developer'].includes(state.role)) return;
    await showScreen(button.dataset.screen);
  });
});

async function showScreen(screenName) {
  document.querySelectorAll('.nav-button').forEach((item) => {
    item.classList.toggle('active', item.dataset.screen === screenName);
  });
  document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('active'));
  document.querySelector(`#${screenName}Screen`).classList.add('active');
  if (screenName === 'previous') await loadPrevious();
  if (screenName === 'dashboard') {
    await loadDashboard();
    await loadTransactions();
  }
  if (screenName === 'queue') await loadQueue();
}

serviceSearch.addEventListener('input', () => {
  renderServiceOptions(serviceSearch.value);
  serviceId.value = '';
});

serviceSearch.addEventListener('focus', () => renderServiceOptions(serviceSearch.value));

document.addEventListener('click', (event) => {
  if (!serviceOptions.contains(event.target) && event.target !== serviceSearch) {
    serviceOptions.classList.remove('open');
  }
});

visitForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    if (!serviceId.value) throw new Error('Select a valid service.');

    const form = new FormData(visitForm);
    const payload = Object.fromEntries(form.entries());
    payload.phone = payload.phone.replace(/\D/g, '');

    const data = await api('/api/visits', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    visitForm.reset();
    setToday();
    renderBootstrap();
    await loadPrevious();
    setStatus(`${data.message} Receipt: ${data.receiptNumber}`);
  } catch (error) {
    setStatus(error.message, true);
  }
});

async function loadPrevious() {
  if (!state.token) return;
  try {
    const rows = await api('/api/staff/recent');
    document.querySelector('#previousEntries').innerHTML = rows
      .map((row) => `
        <div class="row">
          <strong>${row.customer_name}</strong>
          <span>${row.service_name}</span>
          <span>${row.staff_name}</span>
          <span>${money(row.amount_paid)}</span>
          <span class="pill">${row.receipt_status || 'pending'}</span>
        </div>
      `)
      .join('') || '<p class="muted">No entries today.</p>';
  } catch {
    // Staff can still enter visits even if this small panel fails.
  }
}

async function loadDashboard() {
  try {
    const data = await api('/api/owner/dashboard');
    document.querySelector('#todayRevenue').textContent = money(data.today.revenue);
    document.querySelector('#todayVisits').textContent = data.today.visits;
    document.querySelector('#failedReceipts').textContent = data.failedReceipts;
    document.querySelector('#yesterdayRevenue').textContent = money(data.yesterday.revenue);
    document.querySelector('#sessionStatus').textContent = data.session
      ? `Session ${data.session.status} | Visits ${data.session.total_visits} | Revenue ${money(data.session.total_revenue)}`
      : 'No session opened today.';
    document.querySelector('#recentTransactions').innerHTML = data.recentTransactions
      .map((row) => `
        <div class="row">
          <strong>${row.customer_name}</strong>
          <span>${row.service_name}</span>
          <span>${row.staff_name}</span>
          <span>${money(row.amount_paid)}</span>
          <span class="pill">${row.is_void ? 'void' : row.receipt_status || 'pending'}</span>
        </div>
      `)
      .join('') || '<p class="muted">No transactions yet.</p>';
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function loadTransactions() {
  try {
    const rows = await api('/api/owner/transactions?days=14');
    document.querySelector('#transactionHistory').innerHTML = rows
      .map((row) => `
        <div class="row">
          <strong>${row.customer_name}<br><span class="muted">${row.phone}</span></strong>
          <span>${row.service_name}</span>
          <span>${row.staff_name}</span>
          <span>${money(row.amount_paid)}</span>
          <button class="danger" data-void="${row.id}" ${row.is_void ? 'disabled' : ''}>${row.is_void ? 'Voided' : 'Void'}</button>
        </div>
      `)
      .join('') || '<p class="muted">No transactions found.</p>';

    document.querySelectorAll('[data-void]').forEach((button) => {
      button.addEventListener('click', async () => {
        const reason = prompt('Reason for voiding this transaction?', 'Test or wrong entry');
        if (!reason) return;
        await api(`/api/owner/transactions/${button.dataset.void}/void`, {
          method: 'POST',
          body: JSON.stringify({ reason })
        });
        await loadDashboard();
        await loadTransactions();
      });
    });
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function loadQueue() {
  try {
    const data = await api('/api/owner/queue');
    const rows = [
      ...data.receipts.map((item) => ({ type: 'Receipt', ...item })),
      ...data.messages.map((item) => ({ type: 'Reminder', ...item })),
      ...data.webhooks.map((item) => ({ type: 'Webhook', name: item.event_type, phone: item.source, ...item }))
    ];
    document.querySelector('#queueList').innerHTML = rows
      .map((row) => `
        <div class="queue-row">
          <strong>${row.type}: ${row.name || row.receipt_number || row.id}</strong>
          <p class="muted">Status: ${row.status} | Retries: ${row.retry_count}</p>
          ${row.last_error ? `<p class="muted">${row.last_error}</p>` : ''}
          ${row.type === 'Receipt' ? `<button class="ghost resend-button" data-receipt-id="${row.id}">Resend</button>` : ''}
        </div>
      `)
      .join('') || '<p class="muted">Queue is clear.</p>';

    document.querySelectorAll('[data-receipt-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        await api(`/api/owner/receipts/${button.dataset.receiptId}/resend`, {
          method: 'POST',
          body: '{}'
        });
        await loadQueue();
      });
    });
  } catch (error) {
    setStatus(error.message, true);
  }
}

document.querySelector('#refreshDashboard').addEventListener('click', loadDashboard);
document.querySelector('#refreshTransactions').addEventListener('click', loadTransactions);
document.querySelector('#refreshPrevious').addEventListener('click', loadPrevious);
document.querySelector('#closeSession').addEventListener('click', async () => {
  try {
    await api('/api/owner/session/close', { method: 'POST', body: '{}' });
    await loadDashboard();
    setStatus('Day session closed.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.querySelector('#runAutomation').addEventListener('click', async () => {
  try {
    const result = await api('/api/owner/run-automation', { method: 'POST', body: '{}' });
    setStatus(`Automation ran. Receipts: ${result.receiptsProcessed}, reminders: ${result.remindersEnqueued}.`);
    await loadQueue();
  } catch (error) {
    setStatus(error.message, true);
  }
});

setToday();
loadBootstrap().catch(() => {
  localStorage.removeItem('revibe_token');
  localStorage.removeItem('revibe_role');
});
