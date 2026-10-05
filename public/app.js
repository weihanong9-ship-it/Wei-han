'use strict';

const $ = (sel, root = document) => root.querySelector(sel);

// Build DOM nodes without innerHTML so user-supplied text can never inject markup.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'className') node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// 'server' when a FoodLoop server answers; 'local' on static hosting (GitHub Pages).
let mode = 'server';

async function detectMode() {
  if (location.hostname.endsWith('.github.io')) return 'local';
  try {
    const res = await fetch('api/meta', { cache: 'no-store' });
    const isJson = (res.headers.get('Content-Type') || '').includes('application/json');
    if (res.ok && isJson) return 'server';
  } catch { /* no server reachable */ }
  return 'local';
}

async function api(path, options = {}) {
  if (mode === 'local') {
    return window.FoodLoopLocal.request(options.method || 'GET', path, options.body);
  }
  // Relative URL so the app also works when hosted under a sub-path.
  const res = await fetch(path.replace(/^\//, ''), {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) {
    const details = data.details ? `: ${data.details.join('; ')}` : '';
    throw new Error(`${data.error}${details}`);
  }
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function describeDays(days) {
  if (days < 0) return `expired ${-days} day${days === -1 ? '' : 's'} ago`;
  if (days === 0) return 'expires today';
  if (days === 1) return 'expires tomorrow';
  return `${days} days left`;
}

const URGENCY_LABEL = { expired: 'Expired', critical: 'Use now', soon: 'Use soon', ok: 'Fresh' };

/* ---------- Tabs ---------- */

const loaders = {};

function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === name));
  });
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
  try { localStorage.setItem('foodloop-tab', name); } catch { /* storage unavailable */ }
  loaders[name]().catch((err) => console.error(err));
}

document.querySelectorAll('.tabs button').forEach((b) => {
  b.addEventListener('click', () => showTab(b.dataset.tab));
});

/* ---------- Pantry ---------- */

async function loadPantry() {
  const items = await api('/api/pantry');
  const list = $('#pantry-list');
  list.replaceChildren();

  const urgent = items.filter((i) => i.urgency === 'critical' || i.urgency === 'expired');
  const alert = $('#pantry-alert');
  alert.hidden = urgent.length === 0;
  if (urgent.length) {
    alert.textContent = `⚠ ${urgent.length} item${urgent.length === 1 ? '' : 's'} need attention today. `
      + 'Cook them, freeze them, or share them.';
  }

  if (!items.length) {
    list.append(el('p', { className: 'empty' }, 'Nothing tracked yet. Add what you just bought and FoodLoop will remind you before it goes off.'));
    return;
  }

  for (const item of items) {
    list.append(el('div', { className: 'item', dataset: { urgency: item.urgency } },
      el('div', { className: 'item-main' },
        el('div', { className: 'item-title' }, item.name,
          el('span', { className: `badge ${item.urgency}` }, URGENCY_LABEL[item.urgency])),
        el('div', { className: 'item-meta' },
          `${describeDays(item.daysLeft)} · ${item.category} · ${item.weightKg} kg`
          + `${item.nutrition ? ` · ~${item.nutrition.amount.kcal} kcal` : ''}`)),
      el('div', { className: 'actions' },
        el('button', { type: 'button', onclick: () => resolve(item.id, 'eaten') }, '✓ Eaten'),
        item.daysLeft >= 0 && el('button', { type: 'button', onclick: () => openShare(item) }, '🤝 Share'),
        el('button', { type: 'button', className: 'danger', onclick: () => resolve(item.id, 'wasted') }, 'Binned'))));
  }
}
loaders.pantry = loadPantry;

async function resolve(id, outcome) {
  await api(`/api/pantry/${id}`, { method: 'PATCH', body: { outcome } });
  await loadPantry();
}

$('#pantry-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    await api('/api/pantry', { method: 'POST', body: formData(form) });
    form.reset();
    form.expiresOn.value = isoDate(3);
    $('#pantry-error').textContent = '';
    await loadPantry();
    form.name.focus();
  } catch (err) {
    $('#pantry-error').textContent = err.message;
  }
});

/* ---------- Share dialog (pantry -> share board) ---------- */

let sharingItem = null;
const shareDialog = $('#share-dialog');

function openShare(item) {
  sharingItem = item;
  $('#share-name').textContent = item.name;
  $('#share-error').textContent = '';
  $('#share-form').reset();
  shareDialog.showModal();
}

$('#share-cancel').addEventListener('click', () => shareDialog.close());

$('#share-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/api/pantry/${sharingItem.id}/share`, { method: 'POST', body: formData(e.target) });
    shareDialog.close();
    await loadPantry();
  } catch (err) {
    $('#share-error').textContent = err.message;
  }
});

/* ---------- Recipes ---------- */

loaders.recipes = async function loadRecipes() {
  const recipes = await api('/api/recipes');
  const list = $('#recipe-list');
  list.replaceChildren();
  if (!recipes.length) {
    list.append(el('p', { className: 'empty' }, 'No food is expiring in the next 5 days. Nice work!'));
    return;
  }
  for (const r of recipes) {
    list.append(el('div', { className: 'card recipe' },
      el('h2', {}, r.name),
      el('div', { className: 'item-meta' }, `${r.minutes} min`),
      el('div', { className: 'uses' }, 'Uses up: ', r.uses.map((u) => el('span', { className: 'chip' }, u))),
      el('p', {}, r.steps)));
  }
};

/* ---------- Nutrition ---------- */

const NUTRIENT_LABELS = [['kcal', 'kcal', ''], ['protein', 'Protein', ' g'], ['carbs', 'Carbs', ' g'], ['fat', 'Fat', ' g'], ['fibre', 'Fibre', ' g']];
let nutritionReference = [];

function nutrientLine(amount) {
  return el('div', { className: 'nutrients' },
    NUTRIENT_LABELS.map(([key, label, unit]) => el('span', {}, `${label} `, el('b', {}, `${amount[key]}${unit}`))));
}

function renderReference() {
  const query = $('#nutrition-search').value.trim().toLowerCase();
  const rows = nutritionReference.filter((r) => !query
    || r.food.toLowerCase().includes(query)
    || r.highlights.some((h) => h.toLowerCase().includes(query)));
  const body = $('#nutrition-reference');
  if (!rows.length) {
    body.replaceChildren(el('tr', {}, el('td', { colspan: '7', className: 'empty' }, 'No foods match your search.')));
    return;
  }
  body.replaceChildren(...rows.map((r) => el('tr', {},
    el('td', {}, r.food),
    NUTRIENT_LABELS.map(([key]) => el('td', {}, r.per100g[key])),
    el('td', {}, r.highlights.join(', ') || '–'))));
}

$('#nutrition-search').addEventListener('input', renderReference);

loaders.nutrition = async function loadNutrition() {
  const data = await api('/api/nutrition');
  nutritionReference = data.reference;
  renderReference();

  $('#nutrition-totals').replaceChildren(...NUTRIENT_LABELS.map(([key, label, unit]) => el('div', { className: 'stat' },
    el('div', { className: 'stat-value' }, `${data.totals[key]}${unit}`),
    el('div', { className: 'stat-label' }, key === 'kcal' ? 'calories in your pantry' : label))));
  // 2,000 kcal is the common reference daily intake for an adult.
  $('#nutrition-days').textContent = data.items.length
    ? `That's about ${Math.round((data.totals.kcal / 2000) * 10) / 10} days of energy for one adult. Every item you rescue is real nourishment, not just waste avoided.`
    : '';

  const list = $('#nutrition-items');
  list.replaceChildren();
  if (!data.items.length) {
    list.append(el('p', { className: 'empty' }, 'Add food to your pantry to see its nutrition here.'));
  }
  for (const item of data.items) {
    list.append(el('div', { className: 'item', dataset: { urgency: item.urgency } },
      el('div', { className: 'item-main' },
        el('div', { className: 'item-title' }, item.name,
          el('span', { className: `badge ${item.urgency}` }, URGENCY_LABEL[item.urgency])),
        el('div', { className: 'item-meta' }, `${item.weightKg} kg · counted as ${item.nutrition.food} · ${describeDays(item.daysLeft)}`),
        nutrientLine(item.nutrition.amount),
        item.nutrition.highlights.length > 0 && el('div', { className: 'uses' },
          'Good source of: ', item.nutrition.highlights.map((h) => el('span', { className: 'chip' }, h))))));
  }

  const unmatched = $('#nutrition-unmatched');
  unmatched.hidden = data.unmatched.length === 0;
  unmatched.textContent = `No nutrition data yet for: ${data.unmatched.join(', ')}.`;
};

/* ---------- Share board ---------- */

loaders.share = async function loadListings() {
  const listings = await api('/api/listings');
  const list = $('#listing-list');
  list.replaceChildren();
  if (!listings.length) {
    list.append(el('p', { className: 'empty' }, 'No food offered right now. Got extra? Post it above.'));
    return;
  }
  for (const l of listings) {
    list.append(el('div', { className: 'item' },
      el('div', { className: 'item-main' },
        el('div', { className: 'item-title' }, l.title),
        el('div', { className: 'item-meta' },
          `📍 ${l.location}${l.pickupWindow ? ` · 🕒 ${l.pickupWindow}` : ''} · ${describeDays(l.daysLeft)}`),
        el('div', { className: 'item-meta' }, `From ${l.donor}${l.description ? ` · ${l.description}` : ''}`)),
      el('div', { className: 'actions' },
        el('button', { type: 'button', className: 'primary', onclick: () => claim(l) }, "I'll collect it"))));
  }
};

async function claim(listing) {
  const name = prompt(`Claim "${listing.title}"? Enter your name so the donor knows who's coming:`);
  if (name === null) return;
  try {
    await api(`/api/listings/${listing.id}/claim`, { method: 'POST', body: { name } });
    alert(`Claimed! Pick it up at: ${listing.location}${listing.pickupWindow ? ` (${listing.pickupWindow})` : ''}`);
  } catch (err) {
    alert(err.message);
  }
  await loaders.share();
}

$('#listing-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    await api('/api/listings', { method: 'POST', body: formData(form) });
    form.reset();
    form.expiresOn.value = isoDate(1);
    $('#listing-error').textContent = '';
    await loaders.share();
  } catch (err) {
    $('#listing-error').textContent = err.message;
  }
});

/* ---------- Impact ---------- */

loaders.impact = async function loadStats() {
  const s = await api('/api/stats');
  const tiles = [
    [s.rescueRate === null ? '–' : `${s.rescueRate}%`, 'of tracked food rescued'],
    [`${s.savedKg} kg`, 'food eaten or shared'],
    [`${s.co2eSavedKg} kg`, 'CO₂e avoided (est.)'],
    [s.kcalSaved.toLocaleString(), 'calories rescued (est.)'],
    [s.savedMoney.toFixed(2), 'money not wasted'],
    [s.shared, 'items shared'],
    [s.communityMealsShared, 'share-board pickups'],
    [`${s.wastedKg} kg`, 'binned'],
    [s.active, 'items in pantry'],
  ];
  $('#stats').replaceChildren(...tiles.map(([value, label]) => el('div', { className: 'stat' },
    el('div', { className: 'stat-value' }, value),
    el('div', { className: 'stat-label' }, label))));
};

/* ---------- Init ---------- */

(async function init() {
  mode = await detectMode();
  $('#local-banner').hidden = mode !== 'local';
  const meta = await api('/api/meta');
  document.querySelectorAll('.category-select').forEach((select) => {
    select.replaceChildren(...meta.categories.map((c) => el('option', { value: c }, c)));
  });
  $('#pantry-form').expiresOn.value = isoDate(3);
  $('#listing-form').expiresOn.value = isoDate(1);
  let tab = 'pantry';
  try { tab = localStorage.getItem('foodloop-tab') || 'pantry'; } catch { /* storage unavailable */ }
  showTab(loaders[tab] ? tab : 'pantry');
}());
