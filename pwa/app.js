const appState = {
  token: null,
  currentUser: null,
  usuarios: [],
  products: [],
  clients: [],
  orders: [],
  balance: {}
};

const filterState = { searchQuery: '', deliveryFilter: 'all', sellerFilter: 'all', dateFilter: 'all' };
let activeForm = null; // { itemsId, totalId }

const offlineState = { online: navigator.onLine, syncing: false, pendingCount: 0 };

/* ── Utilidades ── */
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function money(n) { return '$' + (Number(n) || 0).toLocaleString('es-CO'); }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function getStartOfWeek(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
function productById(code) {
  return appState.products.find(function(p) { return p.codigo === code; });
}
function productLabel(p) { return p.tipo + ' · ' + p.presentacion + ' huevos'; }
function isAdmin() { return appState.currentUser && appState.currentUser.rol === 'Administrador'; }

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
function isSessionError(err) {
  return /sesi[oó]n/i.test(err && err.message ? err.message : String(err));
}
function isNetworkError(err) {
  const m = String(err && err.message ? err.message : err).toLowerCase();
  return /network|failed to fetch|conexi[oó]n|offline|sin conexi|scripterror|server error|timeout|internet|no se pudo/i.test(m);
}

/* ── Llamadas al servidor (API JSON de Apps Script) ── */
// ⚠️ Reemplaza con la URL de tu implementación ("Deploy") de la web app de Apps Script.
const API_URL = 'https://script.google.com/macros/s/AQUI_EL_ID_DE_TU_IMPLEMENTACION/exec';

function invoke(action, args) {
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ action: action, args: args || [] })
  }).then(function(res) {
    if (!res.ok) throw new Error('Error de red (' + res.status + ')');
    return res.json();
  }).then(function(data) {
    if (data && data.error) throw new Error(data.error);
    return data && data.result;
  });
}

/* ── Base de datos local (IndexedDB) ── */
const DB_NAME = 'pedidos_pwa';
const DB_VERSION = 1;

function openDB() {
  return new Promise(function(resolve, reject) {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB no soportado'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function(e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('outbox')) {
        const os = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
        os.createIndex('ts', 'ts');
      }
    };
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror = function(e) { reject(e.target.error); };
  });
}
function idbPut(store, value, key) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = function() { db.close(); resolve(); };
      tx.onerror = function(e) { db.close(); reject(e.target.error); };
    });
  });
}
function idbGet(store, key) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = function() { db.close(); resolve(req.result); };
      req.onerror = function(e) { db.close(); reject(e.target.error); };
    });
  });
}
function idbDelete(store, key) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = function() { db.close(); resolve(); };
      tx.onerror = function(e) { db.close(); reject(e.target.error); };
    });
  });
}
function idbAll(store) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = function() { db.close(); resolve(req.result || []); };
      req.onerror = function(e) { db.close(); reject(e.target.error); };
    });
  });
}

function cacheAppData(data) { return idbPut('kv', data, 'appData'); }
function loadCachedAppData() { return idbGet('kv', 'appData'); }
function cacheLoginInfo(data) { return idbPut('kv', data, 'loginInfo'); }
function loadCachedLoginInfo() { return idbGet('kv', 'loginInfo'); }
function persistSession(token, user) { return idbPut('kv', { token: token, user: user }, 'session'); }
function loadSession() { return idbGet('kv', 'session'); }
function clearSession() { return idbDelete('kv', 'session'); }

function enqueueOp(op) {
  op.ts = Date.now();
  return idbAdd('outbox', op);
}
function idbAdd(store, value) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).add(value);
      req.onsuccess = function() { resolve(req.result); };
      tx.oncomplete = function() { db.close(); };
      tx.onerror = function(e) { db.close(); reject(e.target.error); };
    });
  });
}
function getOutbox() { return idbAll('outbox'); }
function removeOp(id) { return idbDelete('outbox', id); }

/* ── Escritura con cola offline ── */
function queueWrite(action, args, optimistic) {
  if (navigator.onLine) {
    return invoke(action, args).then(function(res) {
      return { queued: false, result: res };
    }).catch(function(err) {
      if (isNetworkError(err)) {
        if (optimistic) optimistic();
        return enqueueOp({ action: action, args: args }).then(function() {
          setOffline(true);
          refreshPendingCount();
          showToast('Sin conexión: guardado localmente. Se sincronizará automáticamente.');
          return { queued: true };
        });
      }
      throw err;
    });
  } else {
    if (optimistic) optimistic();
    return enqueueOp({ action: action, args: args }).then(function() {
      refreshPendingCount();
      showToast('Sin conexión: guardado localmente. Se sincronizará automáticamente.');
      return { queued: true };
    });
  }
}

function syncOutbox() {
  if (offlineState.syncing) return Promise.resolve();
  if (!navigator.onLine) return Promise.resolve();
  offlineState.syncing = true;
  renderNetStatus();
  return getOutbox().then(function(ops) {
    if (!ops.length) return Promise.resolve();
    ops.sort(function(a, b) { return (a.ts || 0) - (b.ts || 0); });
    return ops.reduce(function(chain, op) {
      return chain.then(function() {
        return invoke(op.action, op.args).then(function() { return removeOp(op.id); });
      });
    }, Promise.resolve());
  }).then(function() {
    offlineState.syncing = false;
    return refreshPendingCount();
  }).catch(function(err) {
    offlineState.syncing = false;
    refreshPendingCount();
    throw err;
  });
}

function refreshPendingCount() {
  return getOutbox().then(function(ops) {
    offlineState.pendingCount = ops.length;
    renderNetStatus();
  }).catch(function() {
    offlineState.pendingCount = 0;
    renderNetStatus();
  });
}

function setOffline(flag) {
  offlineState.online = !flag;
  const banner = document.getElementById('offlineBanner');
  if (banner) banner.classList.toggle('hidden', !flag);
  renderNetStatus();
}

function renderNetStatus() {
  const el = document.getElementById('netStatus');
  if (!el) return;
  if (!offlineState.online) {
    el.classList.remove('hidden');
    el.classList.add('offline');
    el.classList.remove('pending');
    el.textContent = 'Sin conexión';
  } else if (offlineState.pendingCount > 0) {
    el.classList.remove('hidden');
    el.classList.remove('offline');
    el.classList.add('pending');
    el.textContent = offlineState.syncing ? 'Sincronizando…' : (offlineState.pendingCount + ' pendiente(s) · Sincronizar');
  } else {
    el.classList.add('hidden');
  }
}

function onNetStatusClick() {
  if (!offlineState.online || offlineState.pendingCount === 0) return;
  syncOutbox().then(function() {
    showToast('Sincronizado.');
    refreshData();
  }).catch(function(err) {
    showToast(err.message || 'Error al sincronizar.');
  });
}

function initNetworkWatchers() {
  window.addEventListener('online', function() {
    setOffline(false);
    showToast('Conexión restablecida.');
    syncOutbox().then(function() { refreshData(); }).catch(function() {});
  });
  window.addEventListener('offline', function() {
    setOffline(true);
    showToast('Sin conexión.');
  });
}

function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function() {});
  } catch (e) {}
}

/* ── Temas ── */
const THEMES = [
  { id: 'granja', label: 'Granja', tone: 'Claro', meta: '#d97706' },
  { id: 'cielo', label: 'Cielo', tone: 'Claro', meta: '#2563eb' },
  { id: 'bosque', label: 'Bosque', tone: 'Claro', meta: '#059669' },
  { id: 'noche', label: 'Noche', tone: 'Oscuro', meta: '#292524' },
  { id: 'violeta', label: 'Violeta', tone: 'Oscuro', meta: '#27272a' }
];
function currentThemeId() {
  return localStorage.getItem('ph_theme') || 'granja';
}
function applyTheme(themeId) {
  const id = themeId || currentThemeId();
  document.documentElement.setAttribute('data-theme', id);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const t = THEMES.find(function(x) { return x.id === id; });
    if (t) meta.setAttribute('content', t.meta);
  }
}
function setTheme(id) {
  localStorage.setItem('ph_theme', id);
  applyTheme(id);
  document.querySelectorAll('.theme-btn').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-theme-id') === id);
  });
}

/* ── Loader / Toast / Modal ── */
function showLoader(text) {
  document.getElementById('loaderText').textContent = text || 'Cargando...';
  document.getElementById('globalLoader').classList.remove('hidden');
}
function hideLoader() { document.getElementById('globalLoader').classList.add('hidden'); }

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show-toast');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { t.classList.remove('show-toast'); }, 2600);
}

function openModal(html) {
  document.getElementById('modalCard').innerHTML = html;
  document.getElementById('modalOverlay').classList.remove('hidden');
}
function closeModal() { document.getElementById('modalOverlay').classList.add('hidden'); }

/* ── Inicio ── */
function onStart() {
  applyTheme();
  initNetworkWatchers();
  initServiceWorker();
  loadSession().then(function(sess) {
    if (sess && sess.token && sess.user) {
      appState.token = sess.token;
      appState.currentUser = sess.user;
      showLoader('Conectando...');
      loadAppData(true);
    } else {
      populateLogin();
      showLogin();
    }
  }).catch(function() {
    populateLogin();
    showLogin();
  });
}

function populateLogin() {
  invoke('getLoginInfo', []).then(function(data) {
    appState.usuarios = data.usuarios || [];
    cacheLoginInfo(data);
    fillLoginUsers(data.usuarios || []);
    document.getElementById('loginNote').textContent = '¿Primera vez? La contraseña por defecto es 1234.';
  }).catch(function(e) {
    loadCachedLoginInfo().then(function(cached) {
      if (cached && cached.usuarios) {
        fillLoginUsers(cached.usuarios);
        document.getElementById('loginNote').textContent = 'Sin conexión. Ingresa cuando tengas red.';
      } else {
        document.getElementById('loginNote').textContent = 'Sin conexión. Conéctate para iniciar sesión.';
      }
    }).catch(function() {
      document.getElementById('loginNote').textContent = 'Sin conexión. Conéctate para iniciar sesión.';
    });
  });
}

function fillLoginUsers(usuarios) {
  const sel = document.getElementById('loginUser');
  sel.innerHTML = '<option value="">Selecciona tu usuario</option>';
  (usuarios || []).forEach(function(u) {
    const o = document.createElement('option');
    o.value = u; o.textContent = u;
    sel.appendChild(o);
  });
}

function showLogin() {
  document.getElementById('loginScreen').classList.add('active-screen');
  document.getElementById('mainScreen').classList.remove('active-screen');
  document.getElementById('sellerProfile').classList.add('hidden');
}

function login() {
  const usuario = document.getElementById('loginUser').value;
  const contrasena = document.getElementById('loginPass').value;
  if (!usuario) { showToast('Selecciona tu usuario.'); return; }
  if (!contrasena) { showToast('Ingresa tu contraseña.'); return; }

  showLoader('Verificando...');
  invoke('login', [usuario, contrasena]).then(function(res) {
    appState.token = res.token;
    appState.currentUser = res.user;
    return persistSession(res.token, res.user).catch(function() {});
  }).then(function() {
    loadAppData(false);
  }).catch(function(err) {
    hideLoader();
    showToast(err.message || 'Error al iniciar sesión.');
  });
}

function applyAppData(data) {
  appState.products = data.products || [];
  appState.clients = data.clients || [];
  appState.orders = data.orders || [];
  appState.balance = data.balance || {};
  if (data.user) appState.currentUser = data.user;
}

function loadAppData(silent) {
  if (!silent) showLoader('Cargando datos...');
  invoke('getAppData', [appState.token]).then(function(data) {
    applyAppData(data);
    cacheAppData(data);
    hideLoader();
    setOffline(false);
    enterMain();
  }).catch(function(err) {
    hideLoader();
    if (isSessionError(err)) {
      clearSession();
      appState.token = null; appState.currentUser = null;
      showLogin();
      showToast(err.message);
      return;
    }
    if (!navigator.onLine || isNetworkError(err)) {
      loadCachedAppData().then(function(cached) {
        if (cached) {
          applyAppData(cached);
          if (!appState.currentUser) {
            loadSession().then(function(sess) { if (sess) appState.currentUser = sess.user; });
          }
          setOffline(true);
          enterMain();
          showToast('Sin conexión: mostrando datos guardados.');
        } else {
          setOffline(true);
          showLogin();
          showToast('Sin conexión. Conéctate para cargar la app.');
        }
      }).catch(function() {
        showToast('Sin conexión y sin datos en caché.');
      });
    } else {
      showToast(err.message || 'Error al cargar datos.');
    }
  });
}

function refreshData(cb) {
  return invoke('getAppData', [appState.token]).then(function(data) {
    applyAppData(data);
    cacheAppData(data);
    if (cb) cb();
  }).catch(function(err) {
    if (isNetworkError(err)) setOffline(true);
    showToast(err.message || 'Error al refrescar.');
  });
}

function enterMain() {
  document.getElementById('sellerName').textContent = appState.currentUser.nombre + (isAdmin() ? ' · Admin' : '');
  document.getElementById('sellerProfile').classList.remove('hidden');
  document.getElementById('loginScreen').classList.remove('active-screen');
  document.getElementById('mainScreen').classList.add('active-screen');
  document.getElementById('loginPass').value = '';
  refreshPendingCount();
  showTab('new');
}

function logout() {
  if (appState.token) {
    invoke('logout', [appState.token]).catch(function() {});
  }
  clearSession();
  appState.token = null;
  appState.currentUser = null;
  showLogin();
  showToast('Sesión cerrada.');
}

/* ── Pestañas ── */
function showTab(tabName) {
  document.querySelectorAll('.tab-button').forEach(function(b) {
    b.classList.toggle('active', b.id === 'tabButton-' + tabName);
  });
  const content = document.getElementById('tabContent');
  content.innerHTML = '';
  if (tabName === 'new') renderNewOrderTab(content);
  else if (tabName === 'orders') renderOrdersTab(content);
  else if (tabName === 'clients') renderClientsTab(content);
  else if (tabName === 'inventory') renderInventoryTab(content);
  else if (tabName === 'reports') renderReportsTab(content);
  else if (tabName === 'config') renderConfigTab(content);
}

/* ── Items de pedido ── */
function makeItemRow(container, productId, qty) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <select class="item-product"></select>
    <input class="item-qty" type="number" min="1" value="${qty || 1}" inputmode="numeric" />
    <span class="item-subtotal">$0</span>
    <button class="remove-item-btn" type="button" title="Quitar">✕</button>
  `;
  const sel = row.querySelector('.item-product');
  appState.products.forEach(function(p) {
    const o = document.createElement('option');
    o.value = p.codigo; o.textContent = p.tipo + ' · ' + p.presentacion + 'h';
    sel.appendChild(o);
  });
  sel.value = productId || (appState.products[0] && appState.products[0].codigo) || '';
  row.querySelector('.remove-item-btn').addEventListener('click', function() { row.remove(); recomputeTotal(); });
  sel.addEventListener('change', recomputeTotal);
  row.querySelector('.item-qty').addEventListener('input', recomputeTotal);
  container.appendChild(row);
  recomputeTotal();
}

function recomputeTotal() {
  if (!activeForm) return;
  const container = document.getElementById(activeForm.itemsId);
  const totalEl = document.getElementById(activeForm.totalId);
  if (!container || !totalEl) return;
  let total = 0;
  container.querySelectorAll('.item-row').forEach(function(row) {
    const code = row.querySelector('.item-product').value;
    const qty = Number(row.querySelector('.item-qty').value) || 0;
    const p = productById(code);
    const sub = p ? p.precio * qty : 0;
    total += sub;
    row.querySelector('.item-subtotal').textContent = money(sub);
  });
  totalEl.innerHTML = money(total);
}

function collectItems(itemsId) {
  const items = [];
  const container = document.getElementById(itemsId);
  container.querySelectorAll('.item-row').forEach(function(row) {
    const productoId = row.querySelector('.item-product').value;
    const cantidad = Number(row.querySelector('.item-qty').value) || 0;
    if (productoId && cantidad > 0) items.push({ productoId: productoId, cantidad: cantidad });
  });
  return items;
}

/* ── Construcción optimista de pedido local ── */
function buildLocalOrder(order) {
  const items = (order.items || []).map(function(it) {
    const p = productById(it.productoId);
    const precio = p ? p.precio : 0;
    return { ProductoID: it.productoId, Cantidad: it.cantidad, PrecioUnitario: precio, Subtotal: precio * it.cantidad };
  });
  const total = items.reduce(function(s, it) { return s + it.Subtotal; }, 0);
  const pagado = Number(order.valorPagado) || 0;
  const estadoPago = pagado >= total ? 'Pagado' : (pagado > 0 ? 'Abono' : 'Pendiente');
  return {
    ID: order.id,
    Vendedor: appState.currentUser.usuario,
    ClienteID: order.clientId,
    ClienteNombre: order.clientName,
    FechaEntrega: order.fechaEntrega,
    ValorTotal: total,
    MetodoPago: order.metodoPago || 'Efectivo',
    ValorPagado: pagado,
    Alistado: order.alistado || 'No',
    Entregado: order.entregado || 'No',
    FechaCreacion: todayStr(),
    UltimaModificacion: todayStr(),
    EstadoPago: estadoPago,
    items: items,
    _pending: true
  };
}

/* ── Tab: Nuevo pedido ── */
function renderNewOrderTab(container) {
  activeForm = { itemsId: 'orderItems', totalId: 'orderTotal' };
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h2>Registrar nuevo pedido</h2>

    <label for="orderClientSearch">Cliente</label>
    <div class="search-select-container">
      <input id="orderClientSearch" type="text" placeholder="Buscar cliente por nombre o teléfono..." autocomplete="off" />
      <input id="orderClient" type="hidden" />
      <div id="orderClientList" class="search-select-list"></div>
    </div>

    <label for="orderDate">Fecha de entrega</label>
    <input id="orderDate" type="date" />

    <label for="orderPaymentMethod">Método de pago</label>
    <select id="orderPaymentMethod">
      <option value="Efectivo">Efectivo</option>
      <option value="Transferencia">Transferencia</option>
    </select>

    <div class="items-header">
      <span style="font-weight:700; color: var(--stone-800);">Productos</span>
      <button class="small-button secondary-button" type="button" onclick="makeItemRow(document.getElementById('orderItems'))">+ Agregar</button>
    </div>
    <div id="orderItems"></div>

    <div class="toggle-wrapper">
      <label for="orderAlistado" style="margin-bottom:0; font-weight:700;">¿Pedido alistado?</label>
      <label class="switch"><input type="checkbox" id="orderAlistado" /><span class="slider"></span></label>
    </div>
    <div class="toggle-wrapper">
      <label for="orderDelivered" style="margin-bottom:0; font-weight:700;">¿Pedido entregado?</label>
      <label class="switch"><input type="checkbox" id="orderDelivered" /><span class="slider"></span></label>
    </div>

    <label for="orderValuePaid">Abono inicial ($)</label>
    <input id="orderValuePaid" type="number" min="0" value="0" inputmode="numeric" />

    <div class="report-card" style="margin-bottom:18px;">
      <div class="small-note" style="text-transform:uppercase; font-weight:700;">Total</div>
      <div id="orderTotal" class="report-value">$0</div>
    </div>

    <button class="primary-button" onclick="saveOrderAction()">Guardar pedido</button>
  `;
  container.appendChild(card);

  setupClientAutocomplete('orderClientSearch', 'orderClientList', 'orderClient');
  document.getElementById('orderDate').value = todayStr();
  makeItemRow(document.getElementById('orderItems'));
}

function saveOrderAction() {
  const clientId = document.getElementById('orderClient').value;
  const clientName = document.getElementById('orderClientSearch').value;
  const fechaEntrega = document.getElementById('orderDate').value;
  const metodoPago = document.getElementById('orderPaymentMethod').value;
  const valorPagado = Number(document.getElementById('orderValuePaid').value) || 0;
  const alistado = document.getElementById('orderAlistado').checked ? 'Si' : 'No';
  const entregado = document.getElementById('orderDelivered').checked ? 'Si' : 'No';
  const items = collectItems('orderItems');

  if (!clientId) { showToast('Selecciona un cliente de la lista.'); return; }
  if (!fechaEntrega) { showToast('Selecciona la fecha de entrega.'); return; }
  if (items.length === 0) { showToast('Agrega al menos un producto.'); return; }

  const order = { id: uuid(), clientId, clientName, fechaEntrega, metodoPago, valorPagado, alistado, entregado, items };

  const optimistic = function() {
    appState.orders.unshift(buildLocalOrder(order));
  };

  showLoader('Guardando pedido...');
  queueWrite('saveOrder', [order, appState.token], optimistic).then(function(out) {
    hideLoader();
    if (out.queued) {
      showTab('orders');
    } else {
      showToast('Pedido guardado.');
      refreshData(function() { showTab('orders'); });
    }
  }).catch(function(err) { hideLoader(); showToast(err.message || 'Error al guardar.'); });
}

/* ── Tab: Lista de pedidos ── */
function renderOrdersTab(container) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h2>Pedidos</h2>';
  container.appendChild(card);

  filterState.searchQuery = '';
  filterState.deliveryFilter = 'all';
  filterState.sellerFilter = 'all';
  filterState.dateFilter = 'all';

  const filterBar = document.createElement('div');
  filterBar.className = 'filter-bar';
  filterBar.innerHTML = `
    <div class="search-input-wrapper">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input id="ordersSearch" type="text" placeholder="Buscar por cliente o vendedor..." />
    </div>
    <div class="filter-group">
      <button class="filter-btn active" id="btn-deliv-all" onclick="setDeliveryFilter('all')">Todos</button>
      <button class="filter-btn" id="btn-deliv-pending" onclick="setDeliveryFilter('pending')">Pendientes</button>
      <button class="filter-btn" id="btn-deliv-done" onclick="setDeliveryFilter('delivered')">Entregados</button>
    </div>
    <div class="filter-group">
      <button class="filter-btn active" id="btn-seller-all" onclick="setSellerFilter('all')">Todos</button>
      <button class="filter-btn" id="btn-seller-mine" onclick="setSellerFilter('mine')">Míos</button>
    </div>
    <div class="filter-group">
      <button class="filter-btn active" id="btn-date-all" onclick="setDateFilter('all')">Todo</button>
      <button class="filter-btn" id="btn-date-today" onclick="setDateFilter('today')">Hoy</button>
      <button class="filter-btn" id="btn-date-week" onclick="setDateFilter('week')">Semana</button>
      <button class="filter-btn" id="btn-date-month" onclick="setDateFilter('month')">Mes</button>
    </div>
  `;
  card.appendChild(filterBar);

  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrapper';
  wrapper.innerHTML = '<table><thead><tr><th>Vendedor</th><th>Cliente</th><th>Productos</th><th>Entrega</th><th>Alistado</th><th>Entregado</th><th>Pago</th><th>Total</th><th>Acciones</th></tr></thead><tbody id="ordersTableBody"></tbody></table>';
  card.appendChild(wrapper);

  document.getElementById('ordersSearch').addEventListener('input', function(e) {
    filterState.searchQuery = e.target.value;
    renderOrdersRows();
  });
  renderOrdersRows();
}

function setDeliveryFilter(v) {
  filterState.deliveryFilter = v;
  ['all', 'pending', 'delivered'].forEach(function(val) {
    const id = 'btn-deliv-' + (val === 'delivered' ? 'done' : val);
    const b = document.getElementById(id); if (b) b.classList.toggle('active', val === v);
  });
  renderOrdersRows();
}
function setSellerFilter(v) {
  filterState.sellerFilter = v;
  ['all', 'mine'].forEach(function(val) {
    const b = document.getElementById('btn-seller-' + val); if (b) b.classList.toggle('active', val === v);
  });
  renderOrdersRows();
}
function setDateFilter(v) {
  filterState.dateFilter = v;
  ['all', 'today', 'week', 'month'].forEach(function(val) {
    const b = document.getElementById('btn-date-' + val); if (b) b.classList.toggle('active', val === v);
  });
  renderOrdersRows();
}

function itemsSummary(order) {
  return (order.items || []).map(function(it) {
    const p = productById(it.ProductoID);
    return (p ? p.tipo + '·' + p.presentacion : '?') + ' ×' + it.Cantidad;
  }).join(', ');
}

function renderOrdersRows() {
  const body = document.getElementById('ordersTableBody');
  if (!body) return;
  body.innerHTML = '';

  const now = new Date();
  const todayKey = todayStr();
  const weekStart = getStartOfWeek(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const q = filterState.searchQuery.toLowerCase().trim();

  const filtered = appState.orders.filter(function(o) {
    if (q) {
      const client = String(o.ClienteNombre || '').toLowerCase();
      const seller = String(o.Vendedor || '').toLowerCase();
      if (client.indexOf(q) === -1 && seller.indexOf(q) === -1) return false;
    }
    if (filterState.deliveryFilter === 'pending' && o.Entregado === 'Si') return false;
    if (filterState.deliveryFilter === 'delivered' && o.Entregado !== 'Si') return false;
    if (filterState.sellerFilter === 'mine' && o.Vendedor !== appState.currentUser.usuario) return false;
    if (filterState.dateFilter !== 'all') {
      const d = new Date(o.FechaEntrega);
      if (filterState.dateFilter === 'today' && o.FechaEntrega !== todayKey) return false;
      if (filterState.dateFilter === 'week' && d < weekStart) return false;
      if (filterState.dateFilter === 'month' && d < monthStart) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="9" style="text-align:center; color:var(--stone-600); font-style:italic; padding:24px;">No hay pedidos con los filtros actuales.</td></tr>';
    return;
  }

  filtered.forEach(function(o) {
    const isOwn = o.Vendedor === appState.currentUser.usuario;
    const alistadoClass = o.Alistado === 'Si' ? 'alistado-si' : 'alistado-no';
    const entregadoClass = o.Entregado === 'Si' ? 'entregado-si' : 'entregado-no';
    const pill = isOwn ? 'clickable' : '';
    const pendiente = Number(o.ValorTotal) - Number(o.ValorPagado);
    const estadoPill = o.EstadoPago === 'Pagado' ? 'pagado' : (o.EstadoPago === 'Abono' ? 'abono' : 'pendiente');
    const pendingDot = o._pending ? ' <span class="pending-dot" title="Pendiente de sincronizar">●</span>' : '';

    let paymentHTML = '<span class="status-pill ' + estadoPill + '">' + esc(o.EstadoPago) + '</span>';
    if (pendiente > 0) {
      paymentHTML += '<div style="font-size:0.72rem; color:var(--danger-text); font-weight:700;">Debe ' + money(pendiente) + '</div>';
    } else {
      paymentHTML += '<div style="font-size:0.72rem; color:var(--success-text); font-weight:700;">' + money(o.ValorPagado) + ' pagado</div>';
    }

    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${esc(o.Vendedor)}</strong></td>
      <td><strong style="font-size:0.95rem;">${esc(o.ClienteNombre || '—')}${pendingDot}</strong></td>
      <td style="font-size:0.78rem;">${esc(itemsSummary(o)) || '—'}</td>
      <td>${esc(o.FechaEntrega)}</td>
      <td><span class="status-pill ${alistadoClass} ${pill}" ${isOwn ? `onclick="toggleStatus('${o.ID}','Alistado','${o.Alistado === 'Si' ? 'No' : 'Si'}')"` : ''}>${o.Alistado || 'No'}</span></td>
      <td><span class="status-pill ${entregadoClass} ${pill}" ${isOwn ? `onclick="toggleStatus('${o.ID}','Entregado','${o.Entregado === 'Si' ? 'No' : 'Si'}')"` : ''}>${o.Entregado || 'No'}</span></td>
      <td>${paymentHTML}</td>
      <td><strong>${money(o.ValorTotal)}</strong></td>
      <td style="white-space:nowrap;">
        ${isOwn ? `<button class="link-button" onclick="openPayment('${o.ID}')">Cobrar</button>` : ''}
        ${isOwn ? `<button class="link-button" onclick="editOrder('${o.ID}')">Editar</button>` : ''}
      </td>
    `;
    body.appendChild(row);
  });
}

function toggleStatus(orderId, field, value) {
  const o = appState.orders.find(function(x) { return x.ID === orderId; });
  const optimistic = function() {
    if (o) { o[field] = value; o._pending = true; }
    renderOrdersRows();
  };
  queueWrite('toggleOrderState', [orderId, field, value, appState.token], optimistic).then(function(out) {
    if (!out.queued) {
      showToast('Estado actualizado.');
      refreshData(function() { renderOrdersRows(); });
    }
  }).catch(function(err) { showToast(err.message || 'Error.'); });
}

/* ── Cobranza (modal) ── */
function openPayment(orderId) {
  const o = appState.orders.find(function(x) { return x.ID === orderId; });
  if (!o) return;
  const pendiente = Number(o.ValorTotal) - Number(o.ValorPagado);
  openModal(`
    <h2>Registrar abono</h2>
    <p style="font-size:0.88rem; color:var(--stone-700); margin-bottom:12px;">
      <strong>${esc(o.ClienteNombre)}</strong><br/>
      Total: ${money(o.ValorTotal)} · Pagado: ${money(o.ValorPagado)}<br/>
      <span style="color:${pendiente > 0 ? 'var(--danger-text)' : 'var(--success-text)'}; font-weight:700;">Pendiente: ${money(pendiente)}</span>
    </p>
    <label for="payValue">Valor del abono ($)</label>
    <input id="payValue" type="number" min="0" value="${pendiente > 0 ? pendiente : 0}" inputmode="numeric" />
    <label for="payMethod">Método</label>
    <select id="payMethod">
      <option value="Efectivo">Efectivo</option>
      <option value="Transferencia">Transferencia</option>
    </select>
    <button class="primary-button" onclick="savePayment('${o.ID}')">Registrar abono</button>
    <button class="secondary-button" style="margin-top:10px;" onclick="closeModal()">Cancelar</button>
  `);
}

function savePayment(orderId) {
  const valor = Number(document.getElementById('payValue').value) || 0;
  const metodo = document.getElementById('payMethod').value;
  if (valor <= 0) { showToast('Ingresa un valor mayor a 0.'); return; }
  const requestId = uuid();
  const o = appState.orders.find(function(x) { return x.ID === orderId; });

  const optimistic = function() {
    if (o) {
      o.ValorPagado = (Number(o.ValorPagado) || 0) + valor;
      const t = Number(o.ValorTotal) || 0;
      o.EstadoPago = o.ValorPagado >= t ? 'Pagado' : (o.ValorPagado > 0 ? 'Abono' : 'Pendiente');
      o._pending = true;
    }
    closeModal();
    renderOrdersRows();
  };

  queueWrite('registerPayment', [orderId, valor, metodo, appState.token, requestId], optimistic).then(function(out) {
    closeModal();
    if (!out.queued) {
      showToast('Abono registrado.');
      refreshData(function() { renderOrdersRows(); });
    } else {
      showToast('Abono guardado localmente.');
    }
  }).catch(function(err) { closeModal(); showToast(err.message || 'Error.'); });
}

/* ── Tab: Editar pedido ── */
function editOrder(orderId) {
  const o = appState.orders.find(function(x) { return x.ID === orderId; });
  if (!o) return;
  activeForm = { itemsId: 'editOrderItems', totalId: 'editOrderTotal' };
  const content = document.getElementById('tabContent');
  content.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h2>Editar pedido</h2>
    <label for="editOrderClientSearch">Cliente</label>
    <div class="search-select-container">
      <input id="editOrderClientSearch" type="text" value="${esc(o.ClienteNombre || '')}" autocomplete="off" />
      <input id="editOrderClient" type="hidden" value="${esc(o.ClienteID || '')}" />
      <div id="editOrderClientList" class="search-select-list"></div>
    </div>
    <label for="editOrderDate">Fecha de entrega</label>
    <input id="editOrderDate" type="date" value="${esc(o.FechaEntrega)}" />
    <label for="editOrderPaymentMethod">Método de pago</label>
    <select id="editOrderPaymentMethod">
      <option value="Efectivo">Efectivo</option>
      <option value="Transferencia">Transferencia</option>
    </select>
    <div class="items-header">
      <span style="font-weight:700; color:var(--stone-800);">Productos</span>
      <button class="small-button secondary-button" type="button" onclick="makeItemRow(document.getElementById('editOrderItems'))">+ Agregar</button>
    </div>
    <div id="editOrderItems"></div>
    <div class="toggle-wrapper">
      <label for="editOrderAlistado" style="margin-bottom:0; font-weight:700;">¿Pedido alistado?</label>
      <label class="switch"><input type="checkbox" id="editOrderAlistado" ${o.Alistado === 'Si' ? 'checked' : ''} /><span class="slider"></span></label>
    </div>
    <div class="toggle-wrapper">
      <label for="editOrderDelivered" style="margin-bottom:0; font-weight:700;">¿Pedido entregado?</label>
      <label class="switch"><input type="checkbox" id="editOrderDelivered" ${o.Entregado === 'Si' ? 'checked' : ''} /><span class="slider"></span></label>
    </div>
    <div class="report-card" style="margin-bottom:18px;">
      <div class="small-note" style="text-transform:uppercase; font-weight:700;">Total</div>
      <div id="editOrderTotal" class="report-value">$0</div>
    </div>
    <button class="primary-button" onclick="saveOrderEdition('${o.ID}')">Actualizar</button>
    <button class="secondary-button" style="margin-top:10px;" onclick="showTab('orders')">Cancelar</button>
  `;
  content.appendChild(card);

  setupClientAutocomplete('editOrderClientSearch', 'editOrderClientList', 'editOrderClient');
  document.getElementById('editOrderPaymentMethod').value = o.MetodoPago || 'Efectivo';
  const itemsContainer = document.getElementById('editOrderItems');
  (o.items || []).forEach(function(it) { makeItemRow(itemsContainer, it.ProductoID, it.Cantidad); });
  if (!(o.items || []).length) makeItemRow(itemsContainer);
}

function saveOrderEdition(orderId) {
  const clientId = document.getElementById('editOrderClient').value;
  const clientName = document.getElementById('editOrderClientSearch').value;
  const fechaEntrega = document.getElementById('editOrderDate').value;
  const metodoPago = document.getElementById('editOrderPaymentMethod').value;
  const alistado = document.getElementById('editOrderAlistado').checked ? 'Si' : 'No';
  const entregado = document.getElementById('editOrderDelivered').checked ? 'Si' : 'No';
  const items = collectItems('editOrderItems');

  if (!clientId) { showToast('Selecciona un cliente.'); return; }
  if (!fechaEntrega) { showToast('Selecciona la fecha de entrega.'); return; }
  if (items.length === 0) { showToast('Agrega al menos un producto.'); return; }

  const order = { id: orderId, clientId, clientName, fechaEntrega, metodoPago, alistado, entregado, items };

  const optimistic = function() {
    const idx = appState.orders.findIndex(function(x) { return x.ID === orderId; });
    if (idx >= 0) {
      const prev = appState.orders[idx];
      const rebuilt = buildLocalOrder(order);
      rebuilt.ValorPagado = Number(prev.ValorPagado) || 0;
      rebuilt.EstadoPago = prev.EstadoPago || rebuilt.EstadoPago;
      appState.orders[idx] = rebuilt;
    }
  };

  showLoader('Actualizando...');
  queueWrite('updateOrder', [order, appState.token], optimistic).then(function(out) {
    hideLoader();
    if (out.queued) {
      showTab('orders');
    } else {
      showToast('Pedido actualizado.');
      refreshData(function() { showTab('orders'); });
    }
  }).catch(function(err) { hideLoader(); showToast(err.message || 'Error.'); });
}

/* ── Autocompletado de clientes ── */
function setupClientAutocomplete(inputId, listId, hiddenId) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  const hidden = document.getElementById(hiddenId);

  input.addEventListener('focus', function() { filterClients(input.value, list, hidden, input); });
  input.addEventListener('input', function() {
    hidden.value = '';
    filterClients(input.value, list, hidden, input);
  });
  document.addEventListener('click', function(e) {
    if (!input.contains(e.target) && !list.contains(e.target)) list.style.display = 'none';
  });
}

function clientMatchesQuery(client, q) {
  if (!q) return true;
  const name = String(client.Nombre || '').toLowerCase();
  const phone = String(client.Telefono || '').toLowerCase();
  const address = String(client.Direccion || '').toLowerCase();
  if (name.indexOf(q) !== -1 || phone.indexOf(q) !== -1 || address.indexOf(q) !== -1) return true;
  const terms = q.split(/\s+/);
  if (terms.every(function(t) { return name.indexOf(t) !== -1 || phone.indexOf(t) !== -1 || address.indexOf(t) !== -1; })) return true;
  const initials = name.split(/\s+/).filter(Boolean).map(function(w) { return w.charAt(0); }).join('');
  return initials.indexOf(q) === 0 || initials === q;
}

function filterClients(query, list, hidden, input) {
  list.innerHTML = '';
  const q = query.toLowerCase().trim();
  const filtered = appState.clients.filter(function(c) { return clientMatchesQuery(c, q); });
  if (filtered.length === 0) {
    const d = document.createElement('div');
    d.className = 'search-select-item no-results';
    d.textContent = 'No se encontraron clientes';
    list.appendChild(d);
  } else {
    filtered.forEach(function(c) {
      const item = document.createElement('div');
      item.className = 'search-select-item';
      item.textContent = (c.Nombre || '') + (c.Telefono ? ' — ' + c.Telefono : '');
      item.addEventListener('click', function() {
        hidden.value = c.ID;
        input.value = c.Nombre;
        list.style.display = 'none';
      });
      list.appendChild(item);
    });
  }
  list.style.display = 'block';
}

/* ── Tab: Clientes ── */
function renderClientsTab(container) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h2>Registrar cliente</h2>
    <label for="clientName">Nombre / negocio</label>
    <input id="clientName" type="text" placeholder="Ej. Tienda Doña María" />
    <label for="clientAddress">Dirección</label>
    <input id="clientAddress" type="text" placeholder="Ej. Calle 10 # 5-20" />
    <label for="clientPhone">Teléfono</label>
    <input id="clientPhone" type="text" placeholder="Ej. 3123456789" />
    <button class="primary-button" onclick="saveClientAction()">Guardar cliente</button>
  `;
  container.appendChild(card);

  const listCard = document.createElement('div');
  listCard.className = 'card';
  listCard.innerHTML = `
    <h2>Lista de clientes</h2>
    <div class="filter-bar">
      <div class="search-input-wrapper">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="clientsSearch" type="text" placeholder="Buscar cliente..." />
      </div>
    </div>
    <div id="clientsTableContainer"></div>
  `;
  container.appendChild(listCard);

  document.getElementById('clientsSearch').addEventListener('input', function(e) { renderClientsTable(e.target.value); });
  renderClientsTable('');
}

function renderClientsTable(filterQuery) {
  const c = document.getElementById('clientsTableContainer');
  if (!c) return;
  c.innerHTML = '';
  let filtered = appState.clients;
  if (filterQuery) {
    const q = filterQuery.toLowerCase().trim();
    filtered = appState.clients.filter(function(cl) {
      return (String(cl.Nombre || '').toLowerCase().indexOf(q) !== -1) ||
             (String(cl.Telefono || '').toLowerCase().indexOf(q) !== -1) ||
             (String(cl.Direccion || '').toLowerCase().indexOf(q) !== -1);
    });
  }
  filtered = filtered.slice().sort(function(a, b) {
    return String(a.Nombre || '').toLowerCase().localeCompare(String(b.Nombre || '').toLowerCase(), 'es');
  });
  if (filtered.length === 0) {
    c.innerHTML = '<p style="color:var(--stone-600); font-style:italic; padding:12px 0;">No se encontraron clientes.</p>';
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrapper';
  let rows = '';
  filtered.forEach(function(cl) {
    const isOwn = cl.CreadoPor === appState.currentUser.usuario;
    const pendingDot = cl._pending ? ' <span class="pending-dot" title="Pendiente de sincronizar">●</span>' : '';
    rows += `<tr>
      <td><strong>${esc(cl.Nombre)}${pendingDot}</strong></td>
      <td>${esc(cl.Direccion || '—')}</td>
      <td>${esc(cl.Telefono || '—')}</td>
      <td>${esc(cl.CreadoPor || '—')}</td>
      <td>${isOwn ? `<button class="link-button" onclick="editClient('${cl.ID}')">Editar</button>` : '—'}</td>
    </tr>`;
  });
  wrapper.innerHTML = '<table><thead><tr><th>Nombre</th><th>Dirección</th><th>Teléfono</th><th>Registrado por</th><th>Acción</th></tr></thead><tbody>' + rows + '</tbody></table>';
  c.appendChild(wrapper);
}

function saveClientAction() {
  const name = document.getElementById('clientName').value.trim();
  const address = document.getElementById('clientAddress').value.trim();
  const phone = document.getElementById('clientPhone').value.trim();
  if (!name) { showToast('Ingresa el nombre del cliente.'); return; }

  const id = uuid();
  const client = { id: id, name: name, address: address, phone: phone };

  const optimistic = function() {
    appState.clients.unshift({ ID: id, Nombre: name, Direccion: address || '', Telefono: phone || '', CreadoPor: appState.currentUser.usuario, FechaCreacion: todayStr(), _pending: true });
  };

  showLoader('Guardando...');
  queueWrite('saveClient', [client, appState.token], optimistic).then(function(out) {
    hideLoader();
    if (!out.queued && out.result) appState.clients.unshift(out.result);
    showToast(out.queued ? 'Cliente guardado localmente.' : 'Cliente guardado.');
    showTab('clients');
  }).catch(function(err) { hideLoader(); showToast(err.message || 'Error.'); });
}

function editClient(clientId) {
  const cl = appState.clients.find(function(x) { return x.ID === clientId; });
  if (!cl) return;
  openModal(`
    <h2>Editar cliente</h2>
    <label for="editClientName">Nombre</label>
    <input id="editClientName" type="text" value="${esc(cl.Nombre)}" />
    <label for="editClientAddress">Dirección</label>
    <input id="editClientAddress" type="text" value="${esc(cl.Direccion)}" />
    <label for="editClientPhone">Teléfono</label>
    <input id="editClientPhone" type="text" value="${esc(cl.Telefono)}" />
    <button class="primary-button" onclick="saveClientEdition('${cl.ID}')">Actualizar</button>
    <button class="secondary-button" style="margin-top:10px;" onclick="closeModal()">Cancelar</button>
  `);
}

function saveClientEdition(clientId) {
  const name = document.getElementById('editClientName').value.trim();
  const address = document.getElementById('editClientAddress').value.trim();
  const phone = document.getElementById('editClientPhone').value.trim();
  if (!name) { showToast('Ingresa el nombre.'); return; }

  const optimistic = function() {
    const i = appState.clients.findIndex(function(x) { return x.ID === clientId; });
    if (i >= 0) {
      appState.clients[i] = Object.assign({}, appState.clients[i], { Nombre: name, Direccion: address || '', Telefono: phone || '', _pending: true });
    }
    closeModal();
  };

  showLoader('Actualizando...');
  queueWrite('updateClient', [{ id: clientId, name: name, address: address, phone: phone }, appState.token], optimistic).then(function(out) {
    hideLoader();
    closeModal();
    if (!out.queued && out.result) {
      const i = appState.clients.findIndex(function(x) { return x.ID === clientId; });
      if (i >= 0) appState.clients[i] = out.result;
    }
    showToast(out.queued ? 'Cliente actualizado localmente.' : 'Cliente actualizado.');
    showTab('clients');
  }).catch(function(err) { hideLoader(); closeModal(); showToast(err.message || 'Error.'); });
}

/* ── Tab: Inventario ── */
function renderInventoryTab(container) {
  const formCard = document.createElement('div');
  formCard.className = 'card';
  let productInputs = '';
  appState.products.forEach(function(p) {
    productInputs += `<div class="price-row">
      <span class="p-name">${esc(productLabel(p))}</span>
      <input id="prod_${p.codigo}" type="number" min="0" value="0" inputmode="numeric" />
    </div>`;
  });
  formCard.innerHTML = `
    <h2>Registrar producción</h2>
    <label for="invDate">Fecha</label>
    <input id="invDate" type="date" />
    ${productInputs}
    <button class="primary-button" onclick="saveProduccionAction()">Guardar producción</button>
  `;
  container.appendChild(formCard);
  document.getElementById('invDate').value = todayStr();

  const balanceCard = document.createElement('div');
  balanceCard.className = 'card';
  balanceCard.innerHTML = '<h2>Balance: inventario vs pedidos</h2><div id="balanceContent"></div>';
  container.appendChild(balanceCard);
  renderBalance();

  if (isAdmin()) {
    const ajusteCard = document.createElement('div');
    ajusteCard.className = 'card';
    let options = '';
    appState.products.forEach(function(p) { options += `<option value="${p.codigo}">${esc(productLabel(p))}</option>`; });
    ajusteCard.innerHTML = `
      <h2>Ajuste de inventario (admin)</h2>
      <label for="adjProduct">Producto</label>
      <select id="adjProduct">${options}</select>
      <label for="adjQty">Cantidad (usa negativo para restar)</label>
      <input id="adjQty" type="number" value="0" inputmode="numeric" />
      <label for="adjDate">Fecha</label>
      <input id="adjDate" type="date" />
      <button class="primary-button" onclick="saveAjusteAction()">Guardar ajuste</button>
    `;
    container.appendChild(ajusteCard);
    document.getElementById('adjDate').value = todayStr();
  }
}

function renderBalance() {
  const c = document.getElementById('balanceContent');
  if (!c) return;
  let html = '<div class="balance-list">';
  appState.products.forEach(function(p) {
    const b = appState.balance[p.codigo] || { inventariado: 0, pedidos: 0, disponible: 0 };
    const cls = b.disponible < 0 ? 'neg' : 'pos';
    html += `<div class="balance-row">
      <span class="b-name">${esc(productLabel(p))}</span>
      <span class="b-nums">Inv: ${b.inventariado} · Ped: ${b.pedidos}<br/><span class="b-disp ${cls}">${b.disponible >= 0 ? '+' : ''}${b.disponible} disp.</span></span>
    </div>`;
  });
  html += '</div>';
  c.innerHTML = html;
}

function saveProduccionAction() {
  const fecha = document.getElementById('invDate').value;
  if (!fecha) { showToast('Selecciona la fecha.'); return; }
  const items = [];
  appState.products.forEach(function(p) {
    const qty = Number(document.getElementById('prod_' + p.codigo).value) || 0;
    if (qty > 0) items.push({ productoId: p.codigo, cantidad: qty });
  });
  if (items.length === 0) { showToast('Ingresa al menos una cantidad.'); return; }

  const requestId = uuid();
  const optimistic = function() {
    items.forEach(function(it) {
      const b = appState.balance[it.productoId];
      if (b) { b.inventariado += it.cantidad; b.disponible += it.cantidad; }
    });
    appState.products.forEach(function(p) {
      document.getElementById('prod_' + p.codigo).value = 0;
    });
    renderBalance();
  };

  showLoader('Guardando...');
  queueWrite('saveProduccion', [fecha, items, appState.token, requestId], optimistic).then(function(out) {
    hideLoader();
    if (!out.queued && out.result) appState.balance = out.result;
    renderBalance();
    showToast(out.queued ? 'Producción guardada localmente.' : 'Producción guardada.');
  }).catch(function(err) { hideLoader(); showToast(err.message || 'Error.'); });
}

function saveAjusteAction() {
  const productoId = document.getElementById('adjProduct').value;
  const cantidad = Number(document.getElementById('adjQty').value) || 0;
  const fecha = document.getElementById('adjDate').value;
  if (cantidad === 0) { showToast('Ingresa una cantidad distinta de 0.'); return; }
  if (!fecha) { showToast('Selecciona la fecha.'); return; }

  const requestId = uuid();
  const optimistic = function() {
    const b = appState.balance[productoId];
    if (b) { b.inventariado += cantidad; b.disponible += cantidad; }
    document.getElementById('adjQty').value = 0;
    renderBalance();
  };

  showLoader('Guardando...');
  queueWrite('saveAjuste', [fecha, productoId, cantidad, appState.token, requestId], optimistic).then(function(out) {
    hideLoader();
    if (!out.queued && out.result) appState.balance = out.result;
    renderBalance();
    showToast(out.queued ? 'Ajuste guardado localmente.' : 'Ajuste guardado.');
  }).catch(function(err) { hideLoader(); showToast(err.message || 'Error.'); });
}

/* ── Tab: Reportes ── */
function renderReportsTab(container) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h2>Reportes de ventas</h2>';
  container.appendChild(card);

  const todayKey = todayStr();
  const weekStart = getStartOfWeek(new Date());
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  function buildPeriod(fn) {
    const byProduct = {};
    const totals = { flanes: 0, total: 0, paid: 0 };
    appState.orders.forEach(function(o) {
      if (!fn(o)) return;
      (o.items || []).forEach(function(it) {
        const code = it.ProductoID;
        const p = productById(code);
        const qty = Number(it.Cantidad) || 0;
        const precio = Number(it.PrecioUnitario) || (p ? p.precio : 0);
        const sub = precio * qty;
        if (!byProduct[code]) byProduct[code] = { qty: 0, total: 0, label: p ? productLabel(p) : code };
        byProduct[code].qty += qty;
        byProduct[code].total += sub;
        totals.flanes += qty;
        totals.total += sub;
      });
      totals.paid += Number(o.ValorPagado) || 0;
    });
    return { byProduct: byProduct, totals: totals };
  }

  const todayData = buildPeriod(function(o) { return o.FechaEntrega === todayKey; });
  const weekData = buildPeriod(function(o) { return new Date(o.FechaEntrega) >= weekStart; });
  const monthData = buildPeriod(function(o) { return new Date(o.FechaEntrega) >= monthStart; });

  const grid = document.createElement('div');
  grid.className = 'report-grid';

  [['Hoy', todayData], ['Semana', weekData], ['Mes', monthData]].forEach(function(period) {
    const d = period[1];
    const pending = d.totals.total - d.totals.paid;
    let rowsHtml = '';
    Object.keys(d.byProduct).sort().forEach(function(code) {
      const r = d.byProduct[code];
      rowsHtml += '<tr><td>' + esc(r.label) + '</td><td>' + r.qty + '</td><td>' + money(r.total) + '</td></tr>';
    });
    if (!rowsHtml) rowsHtml = '<tr><td colspan="3" style="color:var(--stone-600);">Sin ventas</td></tr>';

    const rCard = document.createElement('div');
    rCard.className = 'report-card';
    rCard.innerHTML = '<strong>Reporte ' + period[0] + '</strong>' +
      '<table class="report-type-table"><thead><tr><th>Producto</th><th>Cant.</th><th>Total</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>' +
      '<div class="report-stats" style="margin-top:8px;">' +
        '<div class="report-stat-item"><div class="report-value">' + d.totals.flanes + '</div><span class="small-note">Flanes</span></div>' +
        '<div class="report-stat-item"><div class="report-value">' + money(d.totals.total) + '</div><span class="small-note">Venta</span></div>' +
        '<div class="report-stat-item"><div class="report-value green-text">' + money(d.totals.paid) + '</div><span class="small-note">Cobrado</span></div>' +
        '<div class="report-stat-item"><div class="report-value" style="color:' + (pending > 0 ? 'var(--danger-text)' : 'var(--success-text)') + ';">' + money(pending) + '</div><span class="small-note">Pendiente</span></div>' +
      '</div>';
    grid.appendChild(rCard);
  });

  container.appendChild(grid);

  // Cartera pendiente por cliente
  const cartera = {};
  appState.orders.forEach(function(o) {
    const pend = Number(o.ValorTotal) - Number(o.ValorPagado);
    if (pend > 0) {
      const key = o.ClienteNombre || 'Sin cliente';
      if (!cartera[key]) cartera[key] = 0;
      cartera[key] += pend;
    }
  });
  const carteraCard = document.createElement('div');
  carteraCard.className = 'card';
  let carteraRows = '';
  Object.keys(cartera).sort().forEach(function(k) {
    carteraRows += '<tr><td>' + esc(k) + '</td><td style="text-align:right; font-weight:700; color:var(--danger-text);">' + money(cartera[k]) + '</td></tr>';
  });
  carteraCard.innerHTML = '<h2>Cartera pendiente por cliente</h2>' +
    (carteraRows ? '<div class="table-wrapper"><table><thead><tr><th>Cliente</th><th style="text-align:right;">Pendiente</th></tr></thead><tbody>' + carteraRows + '</tbody></table></div>'
    : '<p style="color:var(--stone-600);">No hay cartera pendiente.</p>');
  container.appendChild(carteraCard);
}

/* ── Tab: Config ── */
function renderConfigTab(container) {
  const themeCard = document.createElement('div');
  themeCard.className = 'card';
  let themeBtns = '';
  THEMES.forEach(function(t) {
    const active = currentThemeId() === t.id;
    themeBtns += `<button class="theme-btn ${active ? 'active' : ''}" data-theme-id="${t.id}" onclick="setTheme('${t.id}')">
      <span class="theme-swatch theme-swatch-${t.id}"></span>
      <span>${t.label}</span>
      <span class="theme-tone">${t.tone}</span>
    </button>`;
  });
  themeCard.innerHTML = `<h2>Tema</h2><div class="theme-grid">${themeBtns}</div>`;
  container.appendChild(themeCard);

  const passCard = document.createElement('div');
  passCard.className = 'card';
  passCard.innerHTML = `
    <h2>Cambiar mi contraseña</h2>
    <label for="newPass">Nueva contraseña</label>
    <input id="newPass" type="password" />
    <label for="newPass2">Confirmar contraseña</label>
    <input id="newPass2" type="password" />
    <button class="primary-button" onclick="changePasswordAction()">Cambiar contraseña</button>
  `;
  container.appendChild(passCard);

  if (isAdmin()) {
    const priceCard = document.createElement('div');
    priceCard.className = 'card';
    let priceRows = '';
    appState.products.forEach(function(p) {
      priceRows += `<div class="price-row"><span class="p-name">${esc(productLabel(p))}</span><input id="price_${p.codigo}" type="number" min="0" value="${p.precio}" inputmode="numeric" /></div>`;
    });
    priceCard.innerHTML = `
      <h2>Precios (admin)</h2>
      ${priceRows}
      <button class="primary-button" onclick="savePricesAction()">Guardar precios</button>
    `;
    container.appendChild(priceCard);

    const usersCard = document.createElement('div');
    usersCard.className = 'card';
    let userOptions = '';
    (appState.usuarios.length ? appState.usuarios : ['Ivan', 'Nelson', 'William', 'Jorge', 'Leidy', 'Lyda']).forEach(function(u) {
      userOptions += `<option value="${esc(u)}">${esc(u)}</option>`;
    });
    usersCard.innerHTML = `
      <h2>Usuarios (admin)</h2>
      <p style="font-size:0.82rem; color:var(--stone-600); margin-bottom:10px;">Restablece la contraseña de un usuario a la contraseña por defecto (1234).</p>
      <label for="resetUser">Usuario</label>
      <select id="resetUser">${userOptions}</select>
      <button class="primary-button" onclick="resetPasswordAction()">Restablecer contraseña</button>
    `;
    container.appendChild(usersCard);
  }
}

function changePasswordAction() {
  const p1 = document.getElementById('newPass').value;
  const p2 = document.getElementById('newPass2').value;
  if (!p1 || p1.length < 4) { showToast('La contraseña debe tener al menos 4 caracteres.'); return; }
  if (p1 !== p2) { showToast('Las contraseñas no coinciden.'); return; }
  if (!navigator.onLine) { showToast('Requiere conexión a internet.'); return; }
  showLoader('Guardando...');
  invoke('changePassword', [p1, appState.token]).then(function() {
    hideLoader();
    document.getElementById('newPass').value = '';
    document.getElementById('newPass2').value = '';
    showToast('Contraseña actualizada.');
  }).catch(function(err) { hideLoader(); showToast(err.message || 'Error.'); });
}

function savePricesAction() {
  if (!navigator.onLine) { showToast('Requiere conexión a internet.'); return; }
  const items = appState.products.map(function(p) {
    return { codigo: p.codigo, precio: Number(document.getElementById('price_' + p.codigo).value) || 0 };
  });
  if (items.some(function(i) { return i.precio <= 0; })) { showToast('Los precios deben ser mayores a 0.'); return; }
  showLoader('Guardando...');
  invoke('updateProductPrices', [items, appState.token]).then(function(products) {
    hideLoader();
    appState.products = products;
    showToast('Precios actualizados.');
    showTab('config');
  }).catch(function(err) { hideLoader(); showToast(err.message || 'Error.'); });
}

function resetPasswordAction() {
  if (!navigator.onLine) { showToast('Requiere conexión a internet.'); return; }
  const usuario = document.getElementById('resetUser').value;
  showLoader('Restableciendo...');
  invoke('resetPassword', [usuario, appState.token]).then(function() {
    hideLoader();
    showToast('Contraseña restablecida a 1234.');
  }).catch(function(err) { hideLoader(); showToast(err.message || 'Error.'); });
}
