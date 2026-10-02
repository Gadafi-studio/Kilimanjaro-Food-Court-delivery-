const SUPABASE_URL = 'https://wdzjrdjtenhbrnkvhijr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Tm0ykZCa9jqoXO6oaxRPDw_ujhkAX_U';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (s, el = document) => el.querySelector(s);
const KES = n => 'KSh ' + Number(n || 0).toLocaleString('en-KE');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function store(key, val) {
  try { if (val === undefined) return JSON.parse(localStorage.getItem(key)); localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; }
}

async function guard(roles, ready) {
  const m = $('#main'), back = location.href;
  const { data } = await sb.auth.getSession(), u = data.session?.user;
  if (!u) {
    m.innerHTML = '<div class="hero"><h1>Staff sign in</h1><button class="btn dark full" id="g" style="margin-top:16px">Continue with Google</button><label for="em">Or use your email</label><input id="em" type="email"><button class="btn full" id="ml" style="margin-top:10px">Email me a sign-in link</button></div>';
    $('#g').onclick = () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: back } });
    $('#ml').onclick = async () => { const email = $('#em').value.trim(); if (!email) return toast('Enter your email'); const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: back } }); toast(error ? error.message : 'Check your email for the link'); };
    return;
  }
  const { data: role } = await sb.rpc('current_staff_role');
  const out = async () => { await sb.auth.signOut(); location.reload(); };
  if (!role || !roles.includes(role)) {
    m.innerHTML = '<div class="empty"><p>This account has no access to this page.</p><p class="muted">Signed in as ' + esc(u.email) + '. Ask the admin to give you access.</p><button class="btn ghost" id="so" style="margin-top:12px">Sign out</button></div>';
    $('#so').onclick = out; return;
  }
  $('#out').onclick = out; ready(u, role);
}
const ago = t => { const s = Math.floor((Date.now() - new Date(t)) / 1000); return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : Math.floor(s / 3600) + ' h ago'; };
async function call(fn, args, done) { const { error } = await sb.rpc(fn, args); if (error) toast(error.message); else if (done) done(); }


/* ---------- pages ---------- */

function startCustomer() {
$('#main').addEventListener('click', e => { if (e.target.dataset.home) { view = 'menu'; header(); render(); } });
let cats = [], items = [], settings = {}, user = null, view = 'menu', orders = [], chan = null, q = '';
let cart = store('kil_cart') || {};
const STEPS = ['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
const LABEL = { pending: 'Received', preparing: 'Preparing', ready: 'Ready', out_for_delivery: 'On the way', delivered: 'Delivered', rejected: 'Rejected', cancelled: 'Cancelled', failed: 'Delivery failed' };

const count = () => Object.values(cart).reduce((a, b) => a + b, 0);
const sub = () => Object.entries(cart).reduce((s, [id, n]) => s + (items.find(i => i.id === id)?.price_kes || 0) * n, 0);
const fee = () => Number(settings.delivery_fee_kes ?? 100);
const saveCart = () => store('kil_cart', cart);
function setQty(id, n) { if (n <= 0) delete cart[id]; else cart[id] = n; saveCart(); render(); if ($('#cartSheet')) openCart(); }

async function init() {
  const [c, i, s] = await Promise.all([
    sb.from('categories').select('*').order('sort_order'),
    sb.from('menu_items').select('*').order('sort_order'),
    sb.from('settings').select('*')
  ]);
  cats = c.data || []; items = i.data || [];
  (s.data || []).forEach(r => settings[r.key] = r.value);
  Object.keys(cart).forEach(id => { if (!items.find(x => x.id === id)) delete cart[id]; });
  const { data } = await sb.auth.getSession();
  user = data.session?.user || null;
  sb.auth.onAuthStateChange((_e, sess) => { const was = user; user = sess?.user || null; header(); if (user && !was) { watch(); if (store('kil_pending')) { store('kil_pending', false); openCheckout(); } } });
  if (user) watch();
  header(); render();
}

function header() {
  $('#tAuth').textContent = user ? 'Sign out' : 'Sign in';
  $('#tMenu').className = view === 'menu' ? 'on' : '';
  $('#tOrders').className = view === 'orders' ? 'on' : '';
}
$('#tMenu').onclick = () => { view = 'menu'; header(); render(); };
$('#tOrders').onclick = () => { if (!user) return openAuth(); view = 'orders'; header(); loadOrders(); };
$('#tAuth').onclick = async () => { if (user) { await sb.auth.signOut(); orders = []; view = 'menu'; header(); render(); } else openAuth(); };

function render() {
  if (view === 'orders') return renderOrders();
  const f = q.trim().toLowerCase();
  let h = `<section class="hero"><h1>What are you craving today?</h1><p>Fresh Kenyan meals, delivered to your door.</p>
    <input class="search" id="q" type="search" placeholder="Search meals" value="${esc(q)}"></section>`;
  h += `<nav class="chips">${cats.map(c => `<a href="#c-${c.id}">${esc(c.name)}</a>`).join('')}</nav>`;
  for (const c of cats) {
    const list = items.filter(i => i.category_id === c.id && (!f || i.name.toLowerCase().includes(f)));
    if (!list.length) continue;
    h += `<h2 id="c-${c.id}">${esc(c.name)}</h2>` + list.map(i => {
      const n = cart[i.id] || 0;
      const act = !i.available ? '<span class="muted">Sold out</span>'
        : n ? `<div class="qty"><button data-m="${i.id}" aria-label="Remove one">&minus;</button><b>${n}</b><button data-p="${i.id}" aria-label="Add one">+</button></div>`
        : `<button class="btn sm" data-p="${i.id}">+ Add</button>`;
      return `<div class="item ${i.available ? '' : 'out'}"><div class="n"><b>${esc(i.name)}</b><span>${KES(i.price_kes)}</span></div>${act}</div>`;
    }).join('');
  }
  const wa = String(settings.whatsapp_number || '').replace(/\D/g, '');
  if (wa) h += `<a class="wa" href="https://wa.me/${wa}">Need help? Chat with us on WhatsApp</a>`;
  $('#main').innerHTML = h;
  const qi = $('#q'); if (qi) qi.oninput = e => { q = e.target.value; const p = e.target.selectionStart; render(); const n = $('#q'); n.focus(); n.setSelectionRange(p, p); };
  $('#main').querySelectorAll('[data-p]').forEach(b => b.onclick = () => setQty(b.dataset.p, (cart[b.dataset.p] || 0) + 1));
  $('#main').querySelectorAll('[data-m]').forEach(b => b.onclick = () => setQty(b.dataset.m, (cart[b.dataset.m] || 0) - 1));
  bar();
}

function bar() {
  let b = $('#bar'); if (b) b.remove();
  if (!count() || view !== 'menu') return;
  b = document.createElement('button'); b.className = 'bar'; b.id = 'bar';
  b.innerHTML = `<span>${count()} item${count() > 1 ? 's' : ''}</span><span>View cart &middot; ${KES(sub())}</span>`;
  b.onclick = openCart; document.body.appendChild(b);
}

function sheet(html) { $('#layer').innerHTML = `<div class="sheet" id="sh"><div>${html}</div></div>`; $('#sh').onclick = e => { if (e.target.id === 'sh') closeSheet(); }; }
function closeSheet() { $('#layer').innerHTML = ''; }

function openCart() {
  if (!count()) return closeSheet();
  const rows = Object.entries(cart).map(([id, n]) => { const i = items.find(x => x.id === id); return `<div class="item"><div class="n"><b>${esc(i.name)}</b><span>${KES(i.price_kes * n)}</span></div><div class="qty"><button data-m="${id}">&minus;</button><b>${n}</b><button data-p="${id}">+</button></div></div>`; }).join('');
  sheet(`<div id="cartSheet"><h3>Your cart</h3>${rows}
    <div class="row"><span>Subtotal</span><span>${KES(sub())}</span></div>
    <div class="row"><span>Delivery</span><span>${KES(fee())}</span></div>
    <div class="row tot"><span>Total</span><span>${KES(sub() + fee())}</span></div>
    <button class="btn full" id="go" style="margin-top:14px">Checkout</button></div>`);
  $('#layer').querySelectorAll('[data-p]').forEach(b => b.onclick = () => setQty(b.dataset.p, (cart[b.dataset.p] || 0) + 1));
  $('#layer').querySelectorAll('[data-m]').forEach(b => b.onclick = () => setQty(b.dataset.m, (cart[b.dataset.m] || 0) - 1));
  $('#go').onclick = () => user ? openCheckout() : (store('kil_pending', true), openAuth());
}

function openAuth() {
  sheet(`<h3>Sign in to order</h3><p class="muted">You only need to do this once.</p>
    <button class="btn dark full" id="g" style="margin-top:14px">Continue with Google</button>
    <label for="em">Or use your email</label><input id="em" type="email" placeholder="you@example.com" autocomplete="email">
    <button class="btn full" id="ml" style="margin-top:10px">Email me a sign-in link</button>`);
  const back = location.origin + location.pathname;
  $('#g').onclick = () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: back } });
  $('#ml').onclick = async () => {
    const email = $('#em').value.trim(); if (!email) return toast('Enter your email address');
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: back } });
    if (error) return toast(error.message);
    sheet('<h3>Check your email</h3><p>We sent a sign-in link to ' + esc(email) + '. Open it on this phone to continue.</p>');
  };
}

async function openCheckout() {
  const { data: p } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  const pct = Number(settings.cod_deposit_percent ?? 50), total = sub() + fee();
  sheet(`<h3>Delivery details</h3>
    <label for="nm">Name</label><input id="nm" value="${esc(p?.full_name || '')}" autocomplete="name">
    <label for="ph">Phone (M-Pesa number)</label><input id="ph" type="tel" placeholder="07XX XXX XXX" value="${esc(p?.phone || '')}" autocomplete="tel">
    <label for="ad">Delivery address</label><textarea id="ad" rows="2" placeholder="Building, street, landmark">${esc(store('kil_addr') || '')}</textarea>
    <label for="nt">Note for the kitchen (optional)</label><input id="nt">
    <label>Payment</label>
    <label class="pay"><input type="radio" name="pm" value="mpesa" checked><span>M-Pesa<small>Pay ${KES(total)} now</small></span></label>
    <label class="pay"><input type="radio" name="pm" value="card"><span>Card<small>Pay ${KES(total)} now</small></span></label>
    <label class="pay"><input type="radio" name="pm" value="cod"><span>Cash on delivery<small>Pay ${pct}% (${KES(Math.ceil(total * pct / 100))}) by M-Pesa now, the rest in cash at your door</small></span></label>
    <div class="row tot"><span>Total</span><span>${KES(total)}</span></div>
    <button class="btn full" id="po" style="margin-top:14px">Place order</button>`);
  $('#po').onclick = async () => {
    const btn = $('#po'); btn.disabled = true;
    const name = $('#nm').value.trim(), phone = $('#ph').value.trim(), addr = $('#ad').value.trim();
    const { data, error } = await sb.rpc('place_order', {
      p_items: Object.entries(cart).map(([id, n]) => ({ menu_item_id: id, quantity: n })),
      p_customer_name: name, p_customer_phone: phone, p_delivery_address: addr,
      p_notes: $('#nt').value.trim() || null, p_payment_method: document.querySelector('input[name=pm]:checked').value
    });
    if (error) { btn.disabled = false; return toast(error.message); }
    await sb.from('profiles').upsert({ id: user.id, full_name: name, phone });
    store('kil_addr', addr); cart = {}; saveCart();
    sheet(`<h3 style="color:var(--green)">Order placed</h3><p>Your order code is <b>${esc(data.short_code)}</b>.</p>
      <p class="muted" style="margin-top:8px">Amount to pay now: ${KES(data.deposit_required_kes)}. Online payment is switched on in the next build step, so the kitchen sees your order once payment is confirmed.</p>
      <button class="btn full" id="ok" style="margin-top:14px">Track my order</button>`);
    $('#ok').onclick = () => { closeSheet(); view = 'orders'; header(); loadOrders(); };
  };
}

async function loadOrders() {
  if (!user) return;
  const { data } = await sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });
  orders = data || []; if (view === 'orders') render();
}
function watch() {
  loadOrders(); if (chan) sb.removeChannel(chan);
  chan = sb.channel('my-orders').on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: 'customer_id=eq.' + user.id }, loadOrders).subscribe();
}

function renderOrders() {
  if (!orders.length) { $('#main').innerHTML = '<div class="empty"><p>No orders yet.</p><button class="btn" style="margin-top:12px" data-home="1">Browse the menu</button></div>'; return bar(); }
  $('#main').innerHTML = '<h2>My orders</h2>' + orders.map(o => {
    const idx = STEPS.indexOf(o.status), end = idx < 0;
    const steps = end ? '' : `<div class="steps ${o.status === 'delivered' ? 'done' : ''}">${STEPS.map((_, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('')}</div>`;
    const bad = ['rejected', 'cancelled', 'failed'].includes(o.status);
    const why = o.rejected_reason || o.failed_reason;
    const pay = o.payment_status === 'unpaid' ? 'Awaiting payment' : o.payment_status === 'deposit_paid' ? 'Deposit paid, ' + KES(o.balance_due_kes) + ' due in cash' : o.payment_status === 'paid' ? 'Paid' : o.payment_status === 'refund_due' ? 'Refund on its way' : 'Refunded';
    return `<div class="order"><div class="top"><span>${esc(o.short_code)}</span><span class="tag ${bad ? 'bad' : o.status === 'delivered' ? 'ok' : ''}">${LABEL[o.status]}</span></div>${steps}
      <div class="muted">${new Date(o.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</div>
      <div style="margin-top:8px">${o.order_items.map(i => `${i.quantity} &times; ${esc(i.item_name)}`).join('<br>')}</div>
      <div class="row tot"><span>${KES(o.total_kes)}</span><span class="muted" style="font-weight:500;font-size:14px">${pay}</span></div>
      ${why ? `<p class="tag bad">${esc(why)}</p>` : ''}
      ${o.status === 'pending' ? `<button class="btn ghost sm" data-c="${o.id}" style="margin-top:8px">Cancel order</button>` : ''}</div>`;
  }).join('');
  $('#main').querySelectorAll('[data-c]').forEach(b => b.onclick = async () => {
    if (!confirm('Cancel this order?')) return;
    const { error } = await sb.rpc('customer_cancel_order', { p_order_id: b.dataset.c });
    if (error) toast(error.message); else loadOrders();
  });
  bar();
}

init();
}

function startKitchen() {
let orders = [], riders = [], menu = [], tab = 'orders', known = new Set(), first = true;
guard(['kitchen', 'admin'], async () => {
  await load();
  sb.channel('k').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, load).subscribe();
  setInterval(draw, 30000);
});
function beep() { try { const c = new AudioContext(), o = c.createOscillator(); o.connect(c.destination); o.frequency.value = 880; o.start(); setTimeout(() => { o.stop(); c.close(); }, 400); } catch (e) {} }
async function load() {
  const [o, r, m] = await Promise.all([
    sb.from('orders').select('*, order_items(*)').in('status', ['pending', 'preparing', 'ready']).order('created_at'),
    sb.from('riders').select('*').eq('active', true),
    sb.from('menu_items').select('id,name,available').order('name')]);
  orders = o.data || []; riders = r.data || []; menu = m.data || [];
  if (!first && orders.some(x => x.status === 'pending' && !known.has(x.id))) beep();
  orders.forEach(x => known.add(x.id)); first = false; draw();
}
function card(o) {
  const cod = o.payment_method === 'cod';
  let a = '';
  if (o.status === 'pending') a = `<button class="btn sm" data-a="preparing" data-id="${o.id}">Accept</button><button class="btn ghost sm" data-a="rejected" data-id="${o.id}">Reject</button>`;
  else {
    const on = riders.filter(r => r.on_shift);
    a = `<select data-rider="${o.id}">${on.length ? '<option value="">Assign rider…</option>' : '<option value="">No rider on shift</option>'}${on.map(r => `<option value="${r.id}" ${r.id === o.rider_id ? 'selected' : ''}>${esc(r.full_name)}</option>`).join('')}</select>`;
    a += o.status === 'preparing' ? `<button class="btn sm" data-a="ready" data-id="${o.id}">Mark ready</button>` : '<span class="muted">Waiting for rider pickup</span>';
  }
  return `<div class="order"><div class="top"><span>${esc(o.short_code)} · ${esc(o.customer_name)}</span><span class="muted">${ago(o.created_at)}</span></div>
    <div style="margin-top:8px">${o.order_items.map(i => `<b>${i.quantity} ×</b> ${esc(i.item_name)}`).join('<br>')}</div>
    ${o.notes ? `<p class="tag warn">Note: ${esc(o.notes)}</p>` : ''}
    <div class="muted" style="margin-top:6px">${cod ? 'Cash on delivery' : o.payment_method === 'card' ? 'Card, paid' : 'M-Pesa, paid'}${cod ? ' · ' + KES(o.balance_due_kes) + ' due in cash' : ''}</div>
    <div class="acts">${a}</div></div>`;
}
function draw() {
  const sec = (t, s) => { const l = orders.filter(o => o.status === s); return `<h2>${t} (${l.length})</h2>` + (l.map(card).join('') || '<p class="muted">Nothing here.</p>'); };
  let h = `<div class="tabs"><button class="${tab === 'orders' ? 'on' : ''}" data-t="orders">Orders</button><button class="${tab === 'menu' ? 'on' : ''}" data-t="menu">Sold out</button></div>`;
  h += tab === 'orders' ? sec('New', 'pending') + sec('Preparing', 'preparing') + sec('Ready', 'ready')
    : menu.map(m => `<div class="item"><div class="n"><b>${esc(m.name)}</b></div><button class="btn sm ${m.available ? 'ghost' : ''}" data-av="${m.id}" data-v="${m.available}">${m.available ? 'Mark sold out' : 'Sold out — tap to restore'}</button></div>`).join('');
  $('#main').innerHTML = h;
}
$('#main').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.t) { tab = b.dataset.t; return draw(); }
  if (b.dataset.av) return call('set_item_availability', { p_item_id: b.dataset.av, p_available: b.dataset.v !== 'true' }, load);
  if (b.dataset.a) {
    let reason = null;
    if (b.dataset.a === 'rejected') { reason = prompt('Why is this order rejected? The customer will see this.'); if (!reason) return; }
    call('set_order_status', { p_order_id: b.dataset.id, p_status: b.dataset.a, p_reason: reason }, load);
  }
});
$('#main').addEventListener('change', e => { if (e.target.dataset.rider && e.target.value) call('assign_rider', { p_order_id: e.target.dataset.rider, p_rider_id: e.target.value }, load); });
}

function startRider() {
let me = null, orders = [];
guard(['rider', 'admin'], async u => {
  const { data } = await sb.from('riders').select('*').eq('user_id', u.id).maybeSingle();
  me = data;
  if (!me) { $('#main').innerHTML = '<div class="empty"><p>No rider profile is linked to this account yet.</p><p class="muted">Ask the admin to link ' + esc(u.email) + '.</p></div>'; return; }
  await load();
  sb.channel('r').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, load).subscribe();
});
async function load() {
  const [o, r] = await Promise.all([
    sb.from('orders').select('*, order_items(*)').in('status', ['ready', 'out_for_delivery']).order('created_at'),
    sb.from('riders').select('on_shift').eq('id', me.id).single()]);
  orders = o.data || []; me.on_shift = r.data?.on_shift; draw();
}
function draw() {
  let h = `<div class="order"><div class="top"><span>${esc(me.full_name)}</span><span class="tag ${me.on_shift ? 'ok' : ''}">${me.on_shift ? 'On shift' : 'Off shift'}</span></div>
    <button class="btn full ${me.on_shift ? 'ghost' : ''}" id="sh" style="margin-top:10px">${me.on_shift ? 'Go off shift' : 'Go on shift'}</button></div>`;
  h += '<h2>My deliveries</h2>' + (orders.map(o => {
    const cash = o.payment_method === 'cod' ? o.balance_due_kes : 0;
    const maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((o.delivery_lat && o.delivery_lng) ? o.delivery_lat + ',' + o.delivery_lng : o.delivery_address);
    return `<div class="order"><div class="top"><span>${esc(o.short_code)}</span><span class="tag ${o.status === 'ready' ? 'warn' : ''}">${o.status === 'ready' ? 'Ready for pickup' : 'On the way'}</span></div>
      <div style="margin-top:8px"><b>${esc(o.customer_name)}</b> · <a href="tel:${esc(o.customer_phone)}">${esc(o.customer_phone)}</a></div>
      <div>${esc(o.delivery_address)} · <a href="${maps}" target="_blank" rel="noopener">Open map</a></div>
      <div class="muted" style="margin-top:8px">${o.order_items.map(i => `${i.quantity} × ${esc(i.item_name)}`).join(', ')}</div>
      <div class="row tot"><span>${cash ? 'Collect cash' : 'Paid in full'}</span><span class="${cash ? 'tag warn' : 'tag ok'}">${cash ? KES(cash) : 'KSh 0'}</span></div>
      <div class="acts">${o.status === 'ready' ? `<button class="btn" data-a="out_for_delivery" data-id="${o.id}">Picked up</button>`
        : `<button class="btn" data-a="delivered" data-id="${o.id}">Delivered</button><button class="btn ghost" data-a="failed" data-id="${o.id}">Couldn't deliver</button>`}</div></div>`;
  }).join('') || '<div class="empty">No deliveries assigned.</div>');
  $('#main').innerHTML = h;
}
$('#main').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'sh') return call('rider_set_shift', { p_on_shift: !me.on_shift }, load);
  if (!b.dataset.a) return;
  let reason = null;
  if (b.dataset.a === 'failed') { reason = prompt('What went wrong? (e.g. customer unreachable)'); if (!reason) return; }
  if (b.dataset.a === 'delivered' && !confirm('Confirm delivered and any cash collected?')) return;
  call('set_order_status', { p_order_id: b.dataset.id, p_status: b.dataset.a, p_reason: reason }, load);
});
}

function startAdmin() {
let tab = 'overview', days = 7, D = {};
const TABS = { overview: 'Overview', orders: 'Orders', refunds: 'Refunds', menu: 'Menu', riders: 'Riders', settings: 'Settings' };
guard(['admin'], () => {
  load();
  sb.channel('a').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, load).subscribe();
});
async function load() {
  const since = new Date(Date.now() - (days === 1 ? 0 : days) * 864e5); if (days === 1) since.setHours(0, 0, 0, 0);
  const [o, rf, m, r, s] = await Promise.all([
    sb.from('orders').select('*, order_items(*)').gte('created_at', since.toISOString()).order('created_at', { ascending: false }),
    sb.from('refunds').select('*, orders(short_code,customer_name,customer_phone)').order('created_at', { ascending: false }),
    sb.from('menu_items').select('*').order('name'), sb.from('riders').select('*').order('full_name'), sb.from('settings').select('*')]);
  D = { orders: o.data || [], refunds: rf.data || [], menu: m.data || [], riders: r.data || [], set: Object.fromEntries((s.data || []).map(x => [x.key, x.value])) };
  draw();
}
function overview() {
  const live = D.orders.filter(o => !['rejected', 'cancelled'].includes(o.status)), done = live.filter(o => o.status === 'delivered');
  const rev = done.reduce((a, o) => a + o.total_kes, 0), pend = D.orders.filter(o => ['pending', 'preparing', 'ready', 'out_for_delivery'].includes(o.status)).length;
  const avg = done.length ? Math.round(done.reduce((a, o) => a + (new Date(o.delivered_at) - new Date(o.created_at)), 0) / done.length / 60000) : 0;
  const by = {}; D.menu.forEach(m => by[m.name] = 0);
  live.forEach(o => o.order_items.forEach(i => by[i.item_name] = (by[i.item_name] || 0) + i.quantity));
  const rank = Object.entries(by).sort((a, b) => b[1] - a[1]), top = rank.slice(0, 8), mx = Math.max(1, top[0]?.[1] || 1);
  const bars = l => l.map(([n, c]) => `<div class="bar-r"><span>${esc(n)}</span><i style="width:${Math.max(4, c / mx * 45)}%"></i><b>${c}</b></div>`).join('');
  const split = ['mpesa', 'card', 'cod'].map(k => `<div class="row"><span>${{ mpesa: 'M-Pesa', card: 'Card', cod: 'Cash on delivery' }[k]}</span><b>${KES(done.filter(o => o.payment_method === k).reduce((a, o) => a + o.total_kes, 0))}</b></div>`).join('');
  return `<div class="tabs">${[[1, 'Today'], [7, '7 days'], [30, '30 days']].map(([d, l]) => `<button class="${days === d ? 'on' : ''}" data-d="${d}">${l}</button>`).join('')}</div>
    <div class="grid"><div class="stat"><b>${live.length}</b><span>Orders</span></div><div class="stat"><b>${KES(rev)}</b><span>Delivered revenue</span></div>
    <div class="stat"><b>${pend}</b><span>In progress</span></div><div class="stat"><b>${avg} min</b><span>Avg. time to deliver</span></div></div>
    <h2>Most ordered</h2>${top[0]?.[1] ? bars(top) : '<p class="muted">No orders in this period.</p>'}
    <h2>Slowest sellers</h2>${bars(rank.slice(-3).reverse())}<h2>Revenue by payment</h2>${split}`;
}
function ordersTab() { return D.orders.map(o => `<div class="order"><div class="top"><span>${esc(o.short_code)} · ${esc(o.customer_name)}</span><span class="tag">${esc(o.status.replace(/_/g, ' '))}</span></div>
  <div class="muted">${new Date(o.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })} · ${esc(o.customer_phone)}</div>
  <div style="margin-top:6px">${o.order_items.map(i => `${i.quantity} × ${esc(i.item_name)}`).join(', ')}</div>
  <div class="row tot"><span>${KES(o.total_kes)}</span><span class="muted">${esc(o.payment_status.replace(/_/g, ' '))}</span></div></div>`).join('') || '<div class="empty">No orders in this period.</div>'; }
function refundsTab() { const due = D.refunds.filter(r => r.status === 'due'); return `<h2>Refunds due (${due.length})</h2>` + (due.map(r => `<div class="order"><div class="top"><span>${esc(r.orders?.short_code)} · ${KES(r.amount_kes)}</span></div>
  <div>${esc(r.orders?.customer_name)} · ${esc(r.orders?.customer_phone)}</div><div class="muted">${esc(r.reason)}</div>
  <button class="btn sm" data-rf="${r.id}" style="margin-top:8px">Mark refunded</button></div>`).join('') || '<p class="muted">Nothing to refund.</p>'); }
function menuTab() { return D.menu.map(m => `<div class="item"><div class="n"><b>${esc(m.name)}</b></div><input class="in" type="number" min="0" value="${m.price_kes}" data-pr="${m.id}" aria-label="Price"><button class="btn sm ${m.available ? 'ghost' : ''}" data-av="${m.id}" data-v="${m.available}">${m.available ? 'Available' : 'Sold out'}</button></div>`).join(''); }
function ridersTab() { return D.riders.map(r => `<div class="item"><div class="n"><b>${esc(r.full_name)}</b><span class="muted">${esc(r.phone || '')} ${r.user_id ? '' : '· login not linked'}</span></div><span class="tag ${r.on_shift ? 'ok' : ''}">${r.on_shift ? 'On shift' : 'Off'}</span></div>`).join('')
  + `<h2>Add a rider</h2><label for="rn">Name</label><input id="rn"><label for="rp">Phone</label><input id="rp" type="tel"><button class="btn full" id="ar" style="margin-top:12px">Add rider</button>`; }
function settingsTab() { const f = [['restaurant_name', 'Restaurant name'], ['delivery_fee_kes', 'Delivery fee (KSh)'], ['cod_deposit_percent', 'Cash-on-delivery deposit (%)'], ['whatsapp_number', 'WhatsApp number (2547…)']];
  return f.map(([k, l]) => `<label for="s_${k}">${l}</label><input id="s_${k}" value="${esc(D.set[k] ?? '')}">`).join('') + '<button class="btn full" id="ss" style="margin-top:14px">Save settings</button>'; }
function draw() {
  $('#main').innerHTML = `<div class="tabs">${Object.entries(TABS).map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>` + { overview, orders: ordersTab, refunds: refundsTab, menu: menuTab, riders: ridersTab, settings: settingsTab }[tab]();
}
const ok = ({ error }) => { if (error) toast(error.message); else { toast('Saved'); load(); } };
$('#main').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.t) { tab = b.dataset.t; return draw(); }
  if (b.dataset.d) { days = +b.dataset.d; return load(); }
  if (b.dataset.rf) return call('mark_refund_paid', { p_refund_id: b.dataset.rf }, load);
  if (b.dataset.av) return ok(await sb.from('menu_items').update({ available: b.dataset.v !== 'true' }).eq('id', b.dataset.av));
  if (b.id === 'ar') { const n = $('#rn').value.trim(); if (!n) return toast('Enter a name'); return ok(await sb.from('riders').insert({ full_name: n, phone: $('#rp').value.trim() || null })); }
  if (b.id === 'ss') {
    const rows = ['restaurant_name', 'delivery_fee_kes', 'cod_deposit_percent', 'whatsapp_number'].map(k => { const v = $('#s_' + k).value.trim(); return { key: k, value: ['delivery_fee_kes', 'cod_deposit_percent'].includes(k) ? Number(v) : v }; });
    return ok(await sb.from('settings').upsert(rows));
  }
});
$('#main').addEventListener('change', async e => { if (e.target.dataset.pr) ok(await sb.from('menu_items').update({ price_kes: Math.max(0, parseInt(e.target.value) || 0) }).eq('id', e.target.dataset.pr)); });
}

/* ---------- router: / = customer, /#kitchen, /#rider, /#admin = staff ---------- */
const STAFF = { kitchen: [startKitchen, 'Kitchen'], rider: [startRider, 'Rider'], admin: [startAdmin, 'Admin'] }[location.hash.slice(1)];
document.body.dataset.mode = STAFF ? 'staff' : 'customer';
if (STAFF) { $('.brand').innerHTML = STAFF[1] + '<b>.</b>'; document.title = STAFF[1] + ' · Kilimanjaro'; STAFF[0](); } else startCustomer();
window.addEventListener('hashchange', () => location.reload());
