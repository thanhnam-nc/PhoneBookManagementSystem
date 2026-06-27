/* ── State ── */
let allContacts = [];
let currentFilter = 'all';
let currentView = 'list';
let searchTimer = null;
let pendingDeleteId = null;

const COLORS = ['#f97316','#8b5cf6','#ec4899','#06b6d4','#10b981','#f59e0b','#6366f1','#ef4444','#14b8a6','#84cc16'];
function avatarColor(name) {
  let h = 0;
  for (let c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return COLORS[h % COLORS.length];
}
function initials(name) {
  return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

/* ── Load contacts ── */
async function loadContacts(q = '') {
  try {
    const url = q ? `/contacts/search?q=${encodeURIComponent(q)}` : '/contacts/search?q=';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load');
    const data = await res.json();
    allContacts = data.map(c => ({
      contact_id: c.contact_id,
      full_name: c.name,
      phone_number: c.phone || '',
      email: c.email || '',
      tags: c.category ? [c.category] : [],
      is_favorite: c.favorite === 1,
      notes: c.notes || '',
      profile_picture_url: null
    }));
    render();
  } catch (e) {
    console.error(e);
    showToast('Failed to load contacts.', 'error');
  }
}

/* ── Filter ── */
function filterView(type) {
  currentFilter = type;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navMap = { all: 'nav-all', favorites: 'nav-fav', family: 'nav-family', work: 'nav-work', friends: 'nav-friends' };
  document.getElementById(navMap[type])?.classList.add('active');
  const titles = { all: 'All Contacts', favorites: 'Favorites', family: 'Family', work: 'Work', friends: 'Friends' };
  document.getElementById('page-title').textContent = titles[type] || 'All Contacts';
  render();
}

function getFiltered() {
  const q = document.getElementById('search-input').value.trim().toLowerCase();
  let list = allContacts;
  if (currentFilter === 'favorites') list = list.filter(c => c.is_favorite);
  else if (currentFilter === 'family')    list = list.filter(c => (c.tags || []).includes('Family'));
  else if (currentFilter === 'work')      list = list.filter(c => (c.tags || []).includes('Work'));
  else if (currentFilter === 'friends')   list = list.filter(c => (c.tags || []).includes('Friends'));
  if (q) list = list.filter(c =>
    c.full_name.toLowerCase().includes(q) || (c.phone_number || '').includes(q)
  );
  return list;
}

function render() {
  const contacts = getFiltered();
  const container = document.getElementById('contacts-container');
  const empty     = document.getElementById('empty-state');
  const countEl   = document.getElementById('page-count');
  const q         = document.getElementById('search-input').value.trim();

  document.getElementById('badge-all').textContent = allContacts.length;
  document.getElementById('badge-fav').textContent = allContacts.filter(c => c.is_favorite).length;
  document.getElementById('badge-family').textContent  = allContacts.filter(c => (c.tags||[]).includes('Family')).length;
  document.getElementById('badge-work').textContent    = allContacts.filter(c => (c.tags||[]).includes('Work')).length;
  document.getElementById('badge-friends').textContent = allContacts.filter(c => (c.tags||[]).includes('Friends')).length;

  countEl.textContent = `${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`;

  if (contacts.length === 0) {
    container.innerHTML = '';
    container.className = '';
    empty.style.display = '';
    document.getElementById('empty-title').textContent = q ? 'No contacts found' : 'No contacts yet';
    document.getElementById('empty-sub').textContent   = q ? 'Try a different search term.' : 'Click "+ Add" to create your first contact.';
    return;
  }
  empty.style.display = 'none';
  if (currentView === 'grid') renderGrid(container, contacts, q);
  else renderList(container, contacts, q);
}

function renderList(container, contacts, q) {
  container.className = 'contacts-list';
  const favs = contacts.filter(c => c.is_favorite);
  const rest  = contacts.filter(c => !c.is_favorite);
  let html = '';
  if (favs.length) {
    html += `<div class="alpha-group"><div class="alpha-label">★</div>`;
    favs.forEach(c => { html += contactRowHtml(c, q); });
    html += `</div>`;
  }
  const groups = {};
  rest.forEach(c => {
    const letter = c.full_name.trim()[0].toUpperCase();
    if (!groups[letter]) groups[letter] = [];
    groups[letter].push(c);
  });
  Object.keys(groups).sort().forEach(letter => {
    html += `<div class="alpha-group"><div class="alpha-label">${letter}</div>`;
    groups[letter].forEach(c => { html += contactRowHtml(c, q); });
    html += `</div>`;
  });
  container.innerHTML = html;
}

function contactRowHtml(c, q) {
  const col = avatarColor(c.full_name);
  const ini = initials(c.full_name);
  const avatar = c.profile_picture_url
    ? `<img src="${esc(c.profile_picture_url)}" alt="" onerror="this.parentElement.innerHTML='<span>${ini}</span>'" />`
    : `<span>${ini}</span>`;
  const fav = c.is_favorite ? `<div class="fav-star">★</div>` : '';
  const tags = (c.tags || []).map(t => `<span class="contact-tag">${t}</span>`).join('');
  const name  = highlight(esc(c.full_name), q);
  const phone = highlight(esc(c.phone_number || '—'), q);
  return `
    <div class="contact-row" data-id="${c.contact_id}">
      <div class="contact-avatar" style="background:${col}">${avatar}${fav}</div>
      <div class="contact-info">
        <div class="contact-name">${name}</div>
        <div class="contact-phone">${phone}</div>
        ${tags ? `<div class="contact-tags">${tags}</div>` : ''}
      </div>
      <button class="row-delete" onclick="event.stopPropagation();confirmDelete(${c.contact_id})">Delete</button>
      <svg class="row-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    </div>`;
}

function renderGrid(container, contacts, q) {
  container.innerHTML = `<div class="contacts-grid">${contacts.map(c => {
    const col = avatarColor(c.full_name);
    const ini = initials(c.full_name);
    const avatar = c.profile_picture_url
      ? `<img src="${esc(c.profile_picture_url)}" alt="" onerror="this.parentElement.innerHTML='<span>${ini}</span>'" />`
      : `<span>${ini}</span>`;
    const fav  = c.is_favorite ? `<div class="card-fav">★</div>` : '';
    const tags = (c.tags || []).map(t => `<span class="card-tag">${t}</span>`).join('');
    return `
      <div class="contact-card" data-id="${c.contact_id}">
        <div class="card-avatar" style="background:${col}">${avatar}${fav}</div>
        <div class="card-name">${highlight(esc(c.full_name), q)}</div>
        <div class="card-phone">${highlight(esc(c.phone_number || '—'), q)}</div>
        ${tags ? `<div class="card-tags">${tags}</div>` : ''}
        <button class="card-del" onclick="event.stopPropagation();confirmDelete(${c.contact_id})">Delete</button>
      </div>`;
  }).join('')}</div>`;
}

function setView(v) {
  currentView = v;
  document.getElementById('btn-list').classList.toggle('active', v === 'list');
  document.getElementById('btn-grid').classList.toggle('active', v === 'grid');
  render();
}

function handleSearch(val) {
  document.getElementById('search-clear').style.display = val ? '' : 'none';
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => render(), 180);
}
function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').style.display = 'none';
  render();
}

function openModal() {
  resetForm();
  document.getElementById('create-overlay').classList.add('open');
}
function closeModal() {
  document.getElementById('create-overlay').classList.remove('open');
}
function closeModalOutside(e) {
  if (e.target === document.getElementById('create-overlay')) closeModal();
}

function toggleChip(el) { el.classList.toggle('selected'); }

function previewPhoto(url) {
  const prev = document.getElementById('photo-preview');
  if (url) {
    prev.innerHTML = `<img src="${esc(url)}" onerror="this.parentElement.innerHTML='<svg width=28 height=28 viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.5\\'><path d=\\'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\\'/><polyline points=\\'17 8 12 3 7 8\\'/><line x1=\\'12\\' y1=\\'3\\' x2=\\'12\\' y2=\\'15\\'/></svg><span>Photo</span>'" />`;
  } else {
    prev.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span>Photo</span>`;
  }
}

async function submitContact() {
  ['err-name','err-phone','err-email'].forEach(id => document.getElementById(id).textContent = '');
  ['f-name','f-phone','f-email'].forEach(id => document.getElementById(id).classList.remove('error'));
  document.getElementById('form-error').style.display = 'none';

  const full_name    = document.getElementById('f-name').value.trim();
  const phone_number = document.getElementById('f-phone').value.trim();
  const email        = document.getElementById('f-email').value.trim();
  const notes        = document.getElementById('f-notes').value.trim();
  const selectedChip = document.querySelector('.chip.selected');
  const category = selectedChip ? selectedChip.dataset.cat : '';
  const isFav = document.querySelector('.chip.selected[data-cat="Favorites"]') !== null;

  let err = false;
  if (!full_name) { setErr('f-name','err-name','Full name is required.'); err = true; }
  if (!phone_number || !validPhone(phone_number)) { setErr('f-phone','err-phone','Must be 9–11 digits.'); err = true; }
  if (email && !validEmail(email)) { setErr('f-email','err-email','Enter a valid email.'); err = true; }
  if (err) return;

  const formData = new FormData();
  formData.append('name', full_name);
  formData.append('phone', phone_number);
  formData.append('email', email);
  formData.append('notes', notes);
  formData.append('category', category);
  formData.append('favorite', isFav ? '1' : '0');

  try {
    const res = await fetch('/contacts/create', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) { showFormError(data.message || 'Something went wrong.'); return; }
    closeModal();
    showToast('Contact added!', 'success');
    await loadContacts();
  } catch {
    showFormError('Network error. Please try again.');
  }
}

function setErr(inputId, errId, msg) {
  document.getElementById(inputId).classList.add('error');
  document.getElementById(errId).textContent = msg;
}
function showFormError(msg) {
  const el = document.getElementById('form-error');
  el.textContent = msg; el.style.display = '';
}

function resetForm() {
  ['f-name','f-phone','f-email','f-notes','pic-url'].forEach(id => {
    document.getElementById(id).value = '';
    document.getElementById(id).classList.remove('error');
  });
  ['err-name','err-phone','err-email'].forEach(id => document.getElementById(id).textContent = '');
  document.getElementById('form-error').style.display = 'none';
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
  previewPhoto('');
}

function confirmDelete(id) {
  pendingDeleteId = id;
  document.getElementById('delete-overlay').classList.add('open');
  document.getElementById('delete-confirm-btn').onclick = () => doDelete(id);
}
function closeDeleteModal() { document.getElementById('delete-overlay').classList.remove('open'); }
function closeDeleteOutside(e) { if (e.target === document.getElementById('delete-overlay')) closeDeleteModal(); }

async function doDelete(id) {
  closeDeleteModal();
  try {
    const res = await fetch(`/contacts/${id}/delete`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    showToast('Moved to Trash.', 'success');
    await loadContacts();
  } catch { showToast('Delete failed.', 'error'); }
}

let toastT = null;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast${type ? ' ' + type : ''}`;
  void t.offsetWidth; t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function highlight(html, q) {
  if (!q) return html;
  return html.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'),
    '<mark style="background:#eeeeff;color:#4a4de0;border-radius:3px;padding:0 1px">$1</mark>');
}
function validPhone(p) { return /^\d{9,11}$/.test(p.replace(/[\s\-().+]/g,'')); }
function validEmail(e) { return /^[^@]+@[^@]+\.[^@]+$/.test(e); }

document.addEventListener('DOMContentLoaded', () => loadContacts());