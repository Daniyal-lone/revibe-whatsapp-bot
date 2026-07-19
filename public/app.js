const state = {
  token: localStorage.getItem('revibe_token'),
  role: localStorage.getItem('revibe_role') || 'staff',
  staff: [],
  services: []
};

const statusBanner = document.querySelector('#statusBanner');
const visitForm = document.querySelector('#visitForm');
const staffSelect = document.querySelector('#staffSelect');
const serviceSelect = document.querySelector('#serviceSelect');
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

function renderBootstrap() {
  staffSelect.innerHTML = state.staff
    .map((person) => `<option value="${person.id}">${person.name} - ${person.role}</option>`)
    .join('');

  serviceSelect.innerHTML = state.services
    .map((service) => `<option value="${service.id}" data-price="${service.price}">${service.name} - ${money(service.price)}</option>`)
    .join('');

  amountPaid.value = serviceSelect.selectedOptions[0]?.dataset.price || '';
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
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.querySelectorAll('.nav-button').forEach((button) => {
  button.addEventListener('click', async () => {
    document.querySelectorAll('.nav-button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('active'));
    document.querySelector(`#${button.dataset.screen}Screen`).classList.add('active');
    if (button.dataset.screen === 'dashboard') await loadDashboard();
    if (button.dataset.screen === 'queue') await loadQueue();
  });
});

serviceSelect.addEventListener('change', () => {
  amountPaid.value = serviceSelect.selectedOptions[0]?.dataset.price || '';
});

visitForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const form = new FormData(visitForm);
    const payload = Object.fromEntries(form.entries());
    const data = await api('/api/visits', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    visitForm.reset();
    setToday();
    renderBootstrap();
    setStatus(`${data.message} Receipt: ${data.receiptNumber}`);
  } catch (error) {
    setStatus(error.message, true);
  }
});

async function loadDashboard() {
  try {
    const data = await api('/api/owner/dashboard');
    document.querySelector('#todayRevenue').textContent = money(data.today.revenue);
    document.querySelector('#todayVisits').textContent = data.today.visits;
    document.querySelector('#failedReceipts').textContent = data.failedReceipts;
    document.querySelector('#recentTransactions').innerHTML = data.recentTransactions
      .map((row) => `
        <div class="row">
          <strong>${row.customer_name}</strong>
          <span>${row.service_name}</span>
          <span>${row.staff_name}</span>
          <span>${money(row.amount_paid)}</span>
        </div>
      `)
      .join('') || '<p class="muted">No transactions yet.</p>';
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
        </div>
      `)
      .join('') || '<p class="muted">Queue is clear.</p>';
  } catch (error) {
    setStatus(error.message, true);
  }
}

document.querySelector('#refreshDashboard').addEventListener('click', loadDashboard);
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
