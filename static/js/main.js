/* ── State ── */
let allContacts = [];
let trashContacts = [];
let currentFilter = 'all';
let currentView = 'list';
let searchTimer = null;
let pendingDeleteId = null;
let pendingCategoryDeleteId = null;
let customCategories = [];

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
    const urlActive = q ? `/contacts/search?q=${encodeURIComponent(q)}&status=active` : '/contacts/search?q=&status=active';
    const urlTrash = q ? `/contacts/search?q=${encodeURIComponent(q)}&status=trash` : '/contacts/search?q=&status=trash';
    const [resActive, resTrash] = await Promise.all([fetch(urlActive), fetch(urlTrash)]);
    if (!resActive.ok || !resTrash.ok) throw new Error('Failed to load');
    const dataActive = await resActive.json();
    const dataTrash = await resTrash.json();
    const mapper = c => ({
      contact_id: c.contact_id,
      full_name: c.name,
      phone_number: c.phone || '',
      email: c.email || '',
      address: c.address || '',
      tags: c.category ? c.category.split(',').filter(Boolean) : [],
      is_favorite: c.favorite === 1,
      notes: c.notes || '',
      profile_picture_url: null,
      deleted_at: c.deleted_at
    });
    allContacts = dataActive.map(mapper);
    trashContacts = dataTrash.map(mapper);
    render();
    updateCustomBadges();
  } catch (e) {
    console.error(e);
    showToast('Failed to load contacts.', 'error');
  }
}

/* ── Load categories ── */
async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    customCategories = await res.json();
    renderCategorySidebar();
    updateCustomBadges();
  } catch (e) {
    console.error(e);
  }
}

function renderCategorySidebar() {
  const nav = document.getElementById('custom-categories-nav');
  if (!nav) return;
  if (customCategories.length === 0) { nav.innerHTML = ''; return; }
  nav.innerHTML = `<nav class="sidebar-nav">` +
    customCategories.map(cat => `
      <div style="display:flex;align-items:center;padding:0 10px;">
        <a class="nav-item" style="flex:1" id="nav-cat-${cat.category_id}"
          onclick="filterView('cat_${cat.category_id}')">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
            <line x1="7" y1="7" x2="7.01" y2="7"/>
          </svg>
          ${esc(cat.name)}
          <span class="nav-badge" id="badge-cat-${cat.category_id}">0</span>
        </a>
        <button onclick="deleteCategory(${cat.category_id})"
          style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:14px;padding:4px;">✕</button>
      </div>
    `).join('') + `</nav>`;
  updateCustomBadges();
}

function updateCustomBadges() {
  customCategories.forEach(cat => {
    const el = document.getElementById(`badge-cat-${cat.category_id}`);
    if (el) el.textContent = allContacts.filter(c => (c.tags || []).includes(cat.name)).length;
  });
}

async function createCategory() {
  const input = document.getElementById('new-cat-input');
  const name = input.value.trim();
  if (!name) return;
  const res = await fetch('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  if (data.success) {
    input.value = '';
    await loadCategories();
    showToast(`Category "${name}" added!`, 'success');
  } else {
    showToast(data.error || 'Error.', 'error');
  }
}

async function deleteCategory(id) {
  pendingCategoryDeleteId = id;
  document.getElementById('category-delete-overlay').classList.add('open');
}

async function confirmDeleteCategory() {
  const id = pendingCategoryDeleteId;
  closeCategoryDeleteModal();
  if (!id) return;
  try {
    const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    if (currentFilter === `cat_${id}`) currentFilter = 'all';
    await loadCategories();
    await loadContacts();
    showToast('Category deleted.', 'success');
  } catch {
    showToast('Failed to delete category.', 'error');
  } finally {
    pendingCategoryDeleteId = null;
  }
}

function closeCategoryDeleteModal() {
  document.getElementById('category-delete-overlay').classList.remove('open');
  pendingCategoryDeleteId = null;
}

function closeCategoryDeleteOutside(e) {
  if (e.target === document.getElementById('category-delete-overlay')) closeCategoryDeleteModal();
}

/* ── Filter ── */
function filterView(type) {
  currentFilter = type;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navMap = { all: 'nav-all', favorites: 'nav-fav', family: 'nav-family', work: 'nav-work', friends: 'nav-friends', trash: 'nav-trash' };
  if (navMap[type]) {
    document.getElementById(navMap[type])?.classList.add('active');
  } else {
    document.getElementById(`nav-cat-${type.replace('cat_', '')}`)?.classList.add('active');
  }
  const titles = { all: 'All Contacts', favorites: 'Favorites', family: 'Family', work: 'Work', friends: 'Friends', trash: 'Trash' };
  if (titles[type]) {
    document.getElementById('page-title').textContent = titles[type];
  } else {
    const catId = parseInt(type.replace('cat_', ''));
    const cat = customCategories.find(c => c.category_id === catId);
    document.getElementById('page-title').textContent = cat ? cat.name : 'Contacts';
  }
  render();
}

function getFiltered() {
  const q = document.getElementById('search-input').value.trim().toLowerCase();
  let list = currentFilter === 'trash' ? trashContacts : allContacts;
  if (currentFilter === 'favorites') list = list.filter(c => c.is_favorite);
  else if (currentFilter === 'family') list = list.filter(c => (c.tags || []).includes('Family'));
  else if (currentFilter === 'work') list = list.filter(c => (c.tags || []).includes('Work'));
  else if (currentFilter === 'friends') list = list.filter(c => (c.tags || []).includes('Friends'));
  else if (currentFilter.startsWith('cat_')) {
    const catId = parseInt(currentFilter.replace('cat_', ''));
    const cat = customCategories.find(c => c.category_id === catId);
    if (cat) list = list.filter(c => (c.tags || []).includes(cat.name));
  }
  if (q) list = list.filter(c =>
    c.full_name.toLowerCase().includes(q) || (c.phone_number || '').includes(q)
  );
  return list;
}

function render() {
  const contacts = getFiltered();
  const container = document.getElementById('contacts-container');
  const empty = document.getElementById('empty-state');
  const countEl = document.getElementById('page-count');
  const q = document.getElementById('search-input').value.trim();

  document.getElementById('badge-all').textContent = allContacts.length;
  document.getElementById('badge-fav').textContent = allContacts.filter(c => c.is_favorite).length;
  document.getElementById('badge-family').textContent = allContacts.filter(c => (c.tags||[]).includes('Family')).length;
  document.getElementById('badge-work').textContent = allContacts.filter(c => (c.tags||[]).includes('Work')).length;
  document.getElementById('badge-friends').textContent = allContacts.filter(c => (c.tags||[]).includes('Friends')).length;
  if (document.getElementById('badge-trash')) document.getElementById('badge-trash').textContent = trashContacts.length;

  countEl.textContent = `${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`;

  if (contacts.length === 0) {
    container.innerHTML = '';
    container.className = '';
    empty.style.display = '';
    document.getElementById('empty-title').textContent = q ? 'No contacts found' : 'No contacts yet';
    document.getElementById('empty-sub').textContent = q ? 'Try a different search term.' : 'Click "+ Add" to create your first contact.';
    return;
  }
  empty.style.display = 'none';
  if (currentView === 'grid') renderGrid(container, contacts, q);
  else renderList(container, contacts, q);
}

function renderList(container, contacts, q) {
  container.className = 'contacts-list';
  const favs = contacts.filter(c => c.is_favorite);
  const rest = contacts.filter(c => !c.is_favorite);
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
  const name = highlight(esc(c.full_name), q);
  const phone = highlight(esc(c.phone_number || '—'), q);
  const favBtn = `<button class="row-fav" onclick="event.stopPropagation();toggleFavorite(${c.contact_id}, ${c.is_favorite})" style="background:none;border:none;cursor:pointer;font-size:18px;padding:4px 8px;">${c.is_favorite ? '★' : '☆'}</button>`;
  let buttons = favBtn + `<button class="row-delete" onclick="event.stopPropagation();confirmDelete(${c.contact_id})">Delete</button>`;
  if (currentFilter === 'trash') {
    buttons = `
      <button class="row-delete" style="color:#10b981; margin-right:8px;" onclick="event.stopPropagation();doRestore(${c.contact_id})">Restore</button>
      <button class="row-delete" onclick="event.stopPropagation();confirmForceDelete(${c.contact_id})">Delete</button>
    `;
  }
  return `
    <div class="contact-row" data-id="${c.contact_id}" onclick="openDetailsModal(${JSON.stringify(c).replace(/"/g, '&quot;')})">
      <div class="contact-avatar" style="background:${col}">${avatar}${fav}</div>
      <div class="contact-info">
        <div class="contact-name">${name}</div>
        <div class="contact-phone">${phone}</div>
        ${tags ? `<div class="contact-tags">${tags}</div>` : ''}
      </div>
      <div style="display:flex; align-items:center;">${buttons}</div>
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
    const fav = c.is_favorite ? `<div class="card-fav">★</div>` : '';
    const tags = (c.tags || []).map(t => `<span class="card-tag">${t}</span>`).join('');
    let buttons = `<button class="card-del" onclick="event.stopPropagation();confirmDelete(${c.contact_id})">Delete</button>`;
    if (currentFilter === 'trash') {
      buttons = `
        <div style="display:flex; gap:8px; width:100%; margin-top:8px;">
          <button class="card-del" style="flex:1; color:#10b981; background:rgba(16,185,129,0.1);" onclick="event.stopPropagation();doRestore(${c.contact_id})">Restore</button>
          <button class="card-del" style="flex:1;" onclick="event.stopPropagation();confirmForceDelete(${c.contact_id})">Delete</button>
        </div>
      `;
    }
    return `
      <div class="contact-card" data-id="${c.contact_id}" onclick="openDetailsModal(${JSON.stringify(c).replace(/"/g, '&quot;')})">
        <div class="card-avatar" style="background:${col}">${avatar}${fav}</div>
        <div class="card-name">${highlight(esc(c.full_name), q)}</div>
        <div class="card-phone">${highlight(esc(c.phone_number || '—'), q)}</div>
        ${tags ? `<div class="card-tags">${tags}</div>` : ''}
        ${buttons}
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
  // Thêm custom category chips vào create modal
  const chips = document.getElementById('category-chips') || document.querySelector('.category-chips');
  if (chips) {
    chips.querySelectorAll('.custom-chip').forEach(el => el.remove());
    customCategories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'chip custom-chip';
      btn.dataset.cat = cat.name;
      btn.textContent = cat.name;
      btn.onclick = function() { toggleChip(this); };
      chips.appendChild(btn);
    });
  }
  document.getElementById('create-overlay').classList.add('open');
}
function closeModal() { document.getElementById('create-overlay').classList.remove('open'); }
function closeModalOutside(e) { if (e.target === document.getElementById('create-overlay')) closeModal(); }

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

  const full_name = document.getElementById('f-name').value.trim();
  const phone_number = document.getElementById('f-phone').value.trim();
  const email = document.getElementById('f-email').value.trim();
  const address = document.getElementById('f-address').value.trim();
  const notes = document.getElementById('f-notes').value.trim();
  const selectedChips = [...document.querySelectorAll('.chip.selected')];
  const category = selectedChips.filter(c => c.dataset.cat !== 'Favorites').map(c => c.dataset.cat).join(',');
  const isFav = selectedChips.some(c => c.dataset.cat === 'Favorites');

  let err = false;
  if (!full_name) { setErr('f-name','err-name','Full name is required.'); err = true; }
  if (!phone_number || !validPhone(phone_number)) { setErr('f-phone','err-phone','Must be 9–11 digits.'); err = true; }
  if (email && !validEmail(email)) { setErr('f-email','err-email','Enter a valid email.'); err = true; }
  if (err) return;

  const formData = new FormData();
  formData.append('name', full_name);
  formData.append('phone', phone_number);
  formData.append('email', email);
  formData.append('address', address);
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
  ['f-name','f-phone','f-email','f-address','f-notes','pic-url'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.value = '';
      el.classList.remove('error');
    }
  });
  ['err-name','err-phone','err-email'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
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

async function doRestore(id) {
  try {
    const res = await fetch(`/contacts/${id}/restore`, { method: 'POST' });
    if (!res.ok) throw new Error('Restore failed');
    showToast('Contact restored.', 'success');
    await loadContacts();
  } catch { showToast('Restore failed.', 'error'); }
}

function confirmForceDelete(id) {
  pendingDeleteId = id;
  document.getElementById('force-delete-overlay').classList.add('open');
  document.getElementById('force-delete-confirm-btn').onclick = () => doForceDelete(id);
}
function closeForceDeleteModal() { document.getElementById('force-delete-overlay').classList.remove('open'); }
function closeForceDeleteOutside(e) { if (e.target === document.getElementById('force-delete-overlay')) closeForceDeleteModal(); }

async function doForceDelete(id) {
  closeForceDeleteModal();
  try {
    const res = await fetch(`/contacts/${id}/force-delete`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Force delete failed');
    showToast('Permanently deleted.', 'success');
    await loadContacts();
  } catch { showToast('Delete failed.', 'error'); }
}

async function toggleFavorite(id, current) {
  try {
    await fetch(`/contacts/${id}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: current ? 0 : 1 })
    });
    await loadContacts();
  } catch { showToast('Failed to update.', 'error'); }
}

function openEditModal(c) {
  document.getElementById('edit-id').value = c.contact_id;
  document.getElementById('edit-name').value = c.full_name;
  document.getElementById('edit-phone').value = c.phone_number;
  document.getElementById('edit-email').value = c.email;
  document.getElementById('edit-address').value = c.address || '';
  document.getElementById('edit-notes').value = c.notes;
  document.getElementById('edit-fav').checked = c.is_favorite;
  document.getElementById('edit-err-name').textContent = '';
  document.getElementById('edit-err-phone').textContent = '';
  document.getElementById('edit-form-error').style.display = 'none';

  // Reset default chips
  document.querySelectorAll('#edit-chips .chip:not(.custom-chip)').forEach(chip => {
    chip.classList.toggle('selected', (c.tags || []).includes(chip.dataset.cat));
  });

  // Xóa custom chips cũ rồi thêm lại
  document.querySelectorAll('#edit-chips .custom-chip').forEach(el => el.remove());
  const editChips = document.getElementById('edit-chips');
  customCategories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'chip custom-chip';
    btn.dataset.cat = cat.name;
    btn.textContent = cat.name;
    btn.onclick = function() { toggleEditChip(this); };
    if ((c.tags || []).includes(cat.name)) btn.classList.add('selected');
    editChips.appendChild(btn);
  });

  document.getElementById('edit-overlay').classList.add('open');
}

function closeEditModal() { document.getElementById('edit-overlay').classList.remove('open'); }
function closeEditModalOutside(e) { if (e.target === document.getElementById('edit-overlay')) closeEditModal(); }
function toggleEditChip(el) { el.classList.toggle('selected'); }

async function submitEdit() {
  const id = document.getElementById('edit-id').value;
  const name = document.getElementById('edit-name').value.trim();
  const phone = document.getElementById('edit-phone').value.trim();
  const email = document.getElementById('edit-email').value.trim();
  const address = document.getElementById('edit-address').value.trim();
  const notes = document.getElementById('edit-notes').value.trim();
  const favorite = document.getElementById('edit-fav').checked ? 1 : 0;
  const category = [...document.querySelectorAll('#edit-chips .chip.selected')]
    .map(c => c.dataset.cat).join(',');

  if (!name) { document.getElementById('edit-err-name').textContent = 'Name is required.'; return; }
  if (!phone || !validPhone(phone)) { document.getElementById('edit-err-phone').textContent = 'Must be 9–11 digits.'; return; }

  try {
    const res = await fetch(`/contacts/${id}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, email, address, notes, favorite, category })
    });
    const data = await res.json();
    if (data.success) {
      closeEditModal();
      showToast('Contact updated!', 'success');
      await loadContacts();
    } else {
      document.getElementById('edit-form-error').textContent = data.error || 'Error updating.';
      document.getElementById('edit-form-error').style.display = '';
    }
  } catch {
    document.getElementById('edit-form-error').textContent = 'Network error.';
    document.getElementById('edit-form-error').style.display = '';
  }
}

let toastT = null;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast${type ? ' ' + type : ''}`;
  void t.offsetWidth; t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ── View Details Modal ── */
function openDetailsModal(c) {
  const col = avatarColor(c.full_name);
  const ini = initials(c.full_name);
  
  const avatarEl = document.getElementById('details-avatar');
  avatarEl.style.background = col;
  avatarEl.innerHTML = c.profile_picture_url
    ? `<img src="${esc(c.profile_picture_url)}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" alt="" onerror="this.parentElement.innerHTML='<span>${ini}</span>'" />`
    : `<span>${ini}</span>`;
    
  document.getElementById('details-name').textContent = c.full_name;
  
  const favBadge = document.getElementById('details-fav-badge');
  if (c.is_favorite) {
    favBadge.style.display = 'inline-flex';
  } else {
    favBadge.style.display = 'none';
  }
  
  document.getElementById('details-phone').textContent = c.phone_number || '—';
  document.getElementById('details-email').textContent = c.email || '—';
  document.getElementById('details-address').textContent = c.address || '—';
  
  // Render tags
  const tagsContainer = document.getElementById('details-categories');
  tagsContainer.innerHTML = '';
  if (c.tags && c.tags.length > 0) {
    c.tags.forEach(t => {
      const span = document.createElement('span');
      span.className = 'contact-tag';
      span.style.cssText = 'background: #e0e7ff; color: #4338ca; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 500;';
      span.textContent = t;
      tagsContainer.appendChild(span);
    });
  } else {
    tagsContainer.textContent = '—';
  }
  
  document.getElementById('details-notes').textContent = c.notes || '—';
  
  // Set up action buttons
  const deleteBtn = document.getElementById('details-delete-btn');
  const editBtn = document.getElementById('details-edit-btn');
  
  if (c.deleted_at) {
    // Contact is in trash
    editBtn.textContent = 'Restore';
    editBtn.className = 'btn-save';
    editBtn.style.background = '#10b981';
    editBtn.style.borderColor = '#10b981';
    editBtn.onclick = () => {
      closeDetailsModal();
      doRestore(c.contact_id);
    };
    
    deleteBtn.textContent = 'Delete Permanently';
    deleteBtn.onclick = () => {
      closeDetailsModal();
      confirmForceDelete(c.contact_id);
    };
  } else {
    // Normal contact
    editBtn.textContent = 'Edit Contact';
    editBtn.className = 'btn-save';
    editBtn.style.background = '';
    editBtn.style.borderColor = '';
    editBtn.onclick = () => {
      closeDetailsModal();
      openEditModal(c);
    };
    
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = () => {
      closeDetailsModal();
      confirmDelete(c.contact_id);
    };
  }
  
  document.getElementById('details-overlay').classList.add('open');
}

function closeDetailsModal() {
  document.getElementById('details-overlay').classList.remove('open');
}

function closeDetailsModalOutside(e) {
  if (e.target === document.getElementById('details-overlay')) {
    closeDetailsModal();
  }
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

document.addEventListener('DOMContentLoaded', () => {
  loadContacts();
  loadCategories();
});