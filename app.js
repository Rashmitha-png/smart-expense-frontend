/* Smart Expense Tracker - frontend logic */
const API = (window.API_BASE || '').replace(/\/+$/, '') + '/api';
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const fmt = n => '₹ ' + Number(n || 0).toLocaleString('en-IN');
const fmtN = n => Number(n || 0).toLocaleString('en-IN');
const tid = id => 'T' + String(id).padStart(3, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const COLORS = { Food:'#ff9f43', Travel:'#5b9dff', Shopping:'#2ecc8f', Bills:'#a78bfa', Others:'#ff6b9d' };
const colorOf = c => COLORS[c] || '#94a3b8';
const EXP_CATS = ['Food', 'Travel', 'Shopping', 'Bills', 'Others'];
const INC_CATS = ['Salary', 'Freelance', 'Investment', 'Gift', 'Other Income'];

const state = { current: 'dashboard', editing: null, cache: {}, profile: { name: 'User', email: '' } };
let donutChart = null, barChart = null;

async function api(path, opts = {}) {
  const res = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) {
    let msg = 'Something went wrong';
    try { const e = await res.json(); msg = e.message || msg; } catch (_) {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* ---------- navigation ---------- */
const loaders = {
  dashboard: loadDashboard, add: initForm, transactions: loadTransactions,
  budget: loadBudget, reports: loadReports, profile: loadProfileView
};

function go(view) {
  state.current = view;
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + view).classList.remove('hidden');
  $$('.nav[data-go]').forEach(n => n.classList.toggle('active', n.dataset.go === view));
  $('#userMenu').classList.add('hidden');
  window.scrollTo(0, 0);
  loaders[view]().catch(e => toast(e.message, true));
}

document.addEventListener('click', e => {
  const goEl = e.target.closest('[data-go]');
  if (goEl) {
    if (goEl.dataset.go === 'add') state.editing = null;
    go(goEl.dataset.go);
    return;
  }
  const ed = e.target.closest('[data-edit]');
  if (ed) { state.editing = state.cache[ed.dataset.edit]; go('add'); return; }
  const del = e.target.closest('[data-del]');
  if (del) { deleteTx(del.dataset.del); return; }
  if (!e.target.closest('#userMenuBtn')) $('#userMenu').classList.add('hidden');
});

$('#userMenuBtn').addEventListener('click', e => {
  if (e.target.closest('#userMenu')) return;
  $('#userMenu').classList.toggle('hidden');
});

/* ---------- login / logout ---------- */
function showLogin() {
  $('#loginName').value = state.profile.name || '';
  $('#loginEmail').value = state.profile.email || '';
  $('#loginOverlay').classList.remove('hidden');
}
function logout() { localStorage.removeItem('loggedIn'); showLogin(); }
$('#topLogout').onclick = logout;
$('#menuLogout').onclick = logout;
$('#navLogout').onclick = logout;

$('#loginBtn').onclick = async () => {
  const name = $('#loginName').value.trim();
  if (!name) { toast('Please enter your name', true); return; }
  try {
    state.profile = await api('/profile', { method: 'PUT', body: JSON.stringify({ name, email: $('#loginEmail').value.trim() }) });
    localStorage.setItem('loggedIn', 'true');
    $('#loginOverlay').classList.add('hidden');
    applyProfile();
    go('dashboard');
    toast('Welcome, ' + state.profile.name + '!');
  } catch (e) { toast(e.message, true); }
};
$('#loginName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loginBtn').click(); });

function applyProfile() { $$('.uname').forEach(el => el.textContent = state.profile.name); }

/* ---------- table rendering ---------- */
function rows(list) {
  if (!list.length) return '<tr><td class="empty" colspan="7">No transactions found</td></tr>';
  return list.map(t => {
    state.cache[t.id] = t;
    const inc = t.type === 'Income';
    return `<tr>
      <td>${tid(t.id)}</td><td>${t.date}</td>
      <td><span class="badge ${inc ? 'inc' : 'exp'}">${t.type}</span></td>
      <td>${esc(t.category)}</td><td>${esc(t.description)}</td>
      <td class="amt ${inc ? 'pos' : 'neg'}">${inc ? '+' : '-'} ${fmtN(t.amount)}</td>
      <td class="actions">
        <button class="btn edit" data-edit="${t.id}"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn del" data-del="${t.id}"><i class="fa-solid fa-trash"></i> Delete</button>
      </td></tr>`;
  }).join('');
}

async function deleteTx(id) {
  if (!confirm('Delete transaction ' + tid(id) + '?')) return;
  try {
    await api('/transactions/' + id, { method: 'DELETE' });
    toast('Transaction deleted');
    go(state.current);
  } catch (e) { toast(e.message, true); }
}

/* ---------- dashboard ---------- */
async function loadDashboard() {
  const [s, cats, m, recent] = await Promise.all([
    api('/summary'), api('/summary/categories'), api('/summary/monthly'), api('/transactions?limit=5')
  ]);
  $('#cIncome').textContent = fmt(s.totalIncome);
  $('#cExpense').textContent = fmt(s.totalExpenses);
  $('#cBalance').textContent = fmt(s.balance);
  $('#cMonth').textContent = s.thisMonthCount + (s.thisMonthCount === 1 ? ' Transaction' : ' Transactions');
  $('#recentBody').innerHTML = rows(recent);
  $('#donutTotal').textContent = fmt(s.totalExpenses);

  $('#legend').innerHTML = cats.map(c =>
    `<tr><td><span class="dot" style="background:${colorOf(c.category)}"></span>${esc(c.category)}</td><td></td>
     <td>${fmt(c.amount)}</td><td>${c.percent.toFixed(1)}%</td></tr>`).join('');

  if (donutChart) donutChart.destroy();
  donutChart = new Chart($('#donut'), {
    type: 'doughnut',
    data: { labels: cats.map(c => c.category),
      datasets: [{ data: cats.map(c => c.amount), backgroundColor: cats.map(c => colorOf(c.category)), borderWidth: 2, borderColor: '#fff' }] },
    options: { cutout: '66%', maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  if (barChart) barChart.destroy();
  barChart = new Chart($('#bar'), {
    type: 'bar',
    data: { labels: m.labels, datasets: [
      { label: 'Income', data: m.income, backgroundColor: '#3ecf9b', borderRadius: 3 },
      { label: 'Expenses', data: m.expense, backgroundColor: '#ff7a9c', borderRadius: 3 } ] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { font: { size: 10 }, callback: v => fmtN(v) }, grid: { color: '#eef1f8' } },
                x: { grid: { display: false }, ticks: { font: { size: 10 } } } } }
  });
}

/* ---------- add / edit form ---------- */
function fillCategories() {
  const cats = $('#fType').value === 'Income' ? INC_CATS : EXP_CATS;
  $('#fCategory').innerHTML = cats.map(c => `<option>${c}</option>`).join('');
}
$('#fType').addEventListener('change', fillCategories);

async function initForm() {
  const t = state.editing;
  $('#formTitle').textContent = t ? 'Edit Transaction ' + tid(t.id) : 'Add Transaction';
  $('#fSave').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> ' + (t ? 'Update Transaction' : 'Save Transaction');
  $('#fType').value = t ? t.type : 'Expense';
  fillCategories();
  if (t) {
    if (![...$('#fCategory').options].some(o => o.value === t.category)) {
      $('#fCategory').insertAdjacentHTML('beforeend', `<option>${esc(t.category)}</option>`);
    }
    $('#fCategory').value = t.category;
  }
  $('#fDate').value = t ? t.date : new Date().toISOString().slice(0, 10);
  $('#fAmount').value = t ? t.amount : '';
  $('#fDesc').value = t ? (t.description || '') : '';
}

$('#txForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = {
    type: $('#fType').value, date: $('#fDate').value, category: $('#fCategory').value,
    amount: parseFloat($('#fAmount').value), description: $('#fDesc').value.trim()
  };
  try {
    if (state.editing) {
      await api('/transactions/' + state.editing.id, { method: 'PUT', body: JSON.stringify(body) });
      toast('Transaction updated');
    } else {
      await api('/transactions', { method: 'POST', body: JSON.stringify(body) });
      toast('Transaction added');
    }
    state.editing = null;
    go('transactions');
  } catch (err) { toast(err.message, true); }
});
$('#fCancel').onclick = () => { state.editing = null; go('transactions'); };

/* ---------- view transactions ---------- */
function fillFilterCats() {
  const sel = $('#fltCat');
  if (sel.options.length > 1) return;
  [...EXP_CATS, ...INC_CATS].forEach(c => sel.insertAdjacentHTML('beforeend', `<option>${c}</option>`));
}

async function loadTransactions() {
  fillFilterCats();
  const p = new URLSearchParams();
  if ($('#fltQ').value.trim()) p.set('q', $('#fltQ').value.trim());
  if ($('#fltType').value) p.set('type', $('#fltType').value);
  if ($('#fltCat').value) p.set('category', $('#fltCat').value);
  if ($('#fltFrom').value) p.set('from', $('#fltFrom').value);
  if ($('#fltTo').value) p.set('to', $('#fltTo').value);
  const list = await api('/transactions?' + p.toString());
  $('#allBody').innerHTML = rows(list);
}
let qTimer;
$('#fltQ').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => loadTransactions().catch(e => toast(e.message, true)), 250); });
['#fltType', '#fltCat', '#fltFrom', '#fltTo'].forEach(id => $(id).addEventListener('change', () => loadTransactions().catch(e => toast(e.message, true))));
$('#fltClear').onclick = () => { ['#fltQ', '#fltType', '#fltCat', '#fltFrom', '#fltTo'].forEach(id => $(id).value = ''); loadTransactions(); };

async function exportCsv() {
  const list = await api('/transactions');
  const lines = ['ID,Date,Type,Category,Description,Amount'];
  list.forEach(t => lines.push([tid(t.id), t.date, t.type, t.category, '"' + (t.description || '').replace(/"/g, '""') + '"', t.amount].join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'transactions.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('CSV downloaded');
}
$('#exportBtn').onclick = () => exportCsv().catch(e => toast(e.message, true));
$('#repCsv').onclick = () => exportCsv().catch(e => toast(e.message, true));
$('#repPrint').onclick = () => window.print();

/* ---------- budget ---------- */
async function loadBudget() {
  $('#bCategory').innerHTML = EXP_CATS.map(c => `<option>${c}</option>`).join('');
  const list = await api('/budgets');
  if (!list.length) { $('#budgetList').innerHTML = '<p class="sub">No budgets yet. Set one above.</p>'; return; }
  $('#budgetList').innerHTML = list.map(b => {
    const pct = Math.min(100, Math.round(b.spent / b.limit * 100));
    const color = b.spent >= b.limit ? '#e5384f' : pct >= 80 ? '#f59e0b' : '#22c55e';
    const left = b.limit - b.spent;
    return `<div class="bcard">
      <div class="top"><b><span class="dot" style="background:${colorOf(b.category)}"></span>${esc(b.category)}</b>
        <button class="rm" data-rmb="${b.id}" title="Remove budget"><i class="fa-solid fa-trash"></i></button></div>
      <div>${fmt(b.spent)} <small>of ${fmt(b.limit)}</small></div>
      <div class="prog"><i style="width:${pct}%;background:${color}"></i></div>
      <small>${left >= 0 ? fmt(left) + ' left this month' : 'Over budget by ' + fmt(-left)} (${Math.round(b.spent / b.limit * 100)}%)</small>
    </div>`;
  }).join('');
}
$('#budgetForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('/budgets', { method: 'POST', body: JSON.stringify({ category: $('#bCategory').value, limit: parseFloat($('#bLimit').value) }) });
    $('#bLimit').value = '';
    toast('Budget saved');
    loadBudget();
  } catch (err) { toast(err.message, true); }
});
$('#budgetList').addEventListener('click', async e => {
  const b = e.target.closest('[data-rmb]');
  if (!b || !confirm('Remove this budget?')) return;
  try { await api('/budgets/' + b.dataset.rmb, { method: 'DELETE' }); toast('Budget removed'); loadBudget(); }
  catch (err) { toast(err.message, true); }
});

/* ---------- reports ---------- */
async function loadReports() {
  const [s, cats, m] = await Promise.all([api('/summary'), api('/summary/categories'), api('/summary/monthly')]);
  const rate = s.totalIncome ? Math.round((s.balance / s.totalIncome) * 100) : 0;
  $('#repCards').innerHTML = `
    <div class="card green"><div class="ic"><i class="fa-solid fa-coins"></i></div><div><span>Total Income</span><b>${fmt(s.totalIncome)}</b></div></div>
    <div class="card pink"><div class="ic"><i class="fa-regular fa-credit-card"></i></div><div><span>Total Expenses</span><b>${fmt(s.totalExpenses)}</b></div></div>
    <div class="card blue"><div class="ic"><i class="fa-solid fa-wallet"></i></div><div><span>Net Savings</span><b>${fmt(s.balance)}</b></div></div>
    <div class="card yellow"><div class="ic"><i class="fa-solid fa-percent"></i></div><div><span>Savings Rate</span><b>${rate}%</b></div></div>`;
  $('#repCat').innerHTML = cats.length
    ? cats.map(c => `<tr><td><span class="dot" style="background:${colorOf(c.category)}"></span>${esc(c.category)}</td><td>${fmt(c.amount)}</td><td>${c.percent.toFixed(1)}%</td></tr>`).join('')
    : '<tr><td class="empty" colspan="3">No expenses yet</td></tr>';
  $('#repMonth').innerHTML = m.labels.map((l, i) =>
    `<tr><td>${l} ${m.year}</td><td class="amt pos">${fmt(m.income[i])}</td><td class="amt neg">${fmt(m.expense[i])}</td><td>${fmt(m.income[i] - m.expense[i])}</td></tr>`).join('');
}

/* ---------- profile ---------- */
async function loadProfileView() {
  state.profile = await api('/profile');
  $('#pName').value = state.profile.name || '';
  $('#pEmail').value = state.profile.email || '';
  $('#pEmailShow').textContent = state.profile.email || '';
  applyProfile();
}
$('#profileForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    state.profile = await api('/profile', { method: 'PUT', body: JSON.stringify({ name: $('#pName').value.trim(), email: $('#pEmail').value.trim() }) });
    applyProfile();
    $('#pEmailShow').textContent = state.profile.email || '';
    toast('Profile saved');
  } catch (err) { toast(err.message, true); }
});

/* ---------- start ---------- */
(async function init() {
  $('#todayDate').textContent = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  try { state.profile = await api('/profile'); } catch (_) {}
  applyProfile();
  if (localStorage.getItem('loggedIn') !== 'true') showLogin();
  go('dashboard');
})();
