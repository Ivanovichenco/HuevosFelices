/***************************************************************************
 * Pedidos de Huevos — Distribuidora
 * Backend Google Apps Script + Google Sheets como base de datos.
 ***************************************************************************/

var PASSWORD_DEFAULT = '1234';
var HASH_SALT = 'pedidos_huevos_v1';
var SESSION_PREFIX = 'sesion_';
var SESSION_TTL = 21600; // 6 horas (máximo permitido por Script Cache)

var HEADERS = {
  Usuarios: ['ID', 'Usuario', 'Nombre', 'HashContrasena', 'Rol', 'Activo'],
  Clientes: ['ID', 'Nombre', 'Direccion', 'Telefono', 'CreadoPor', 'FechaCreacion'],
  Productos: ['Codigo', 'Tipo', 'Presentacion', 'Precio', 'Activo'],
  Pedidos: ['ID', 'Vendedor', 'ClienteID', 'ClienteNombre', 'FechaEntrega', 'ValorTotal', 'MetodoPago', 'ValorPagado', 'Alistado', 'Entregado', 'FechaCreacion', 'UltimaModificacion'],
  DetallePedidos: ['PedidoID', 'ProductoID', 'Cantidad', 'PrecioUnitario', 'Subtotal'],
  Inventario: ['ID', 'Fecha', 'ProductoID', 'TipoMovimiento', 'Cantidad', 'RegistradoPor', 'FechaCreacion'],
  Pagos: ['ID', 'PedidoID', 'Fecha', 'Valor', 'MetodoPago', 'RegistradoPor']
};

var PRODUCTOS_DEFAULT = [
  { codigo: 'B-30',  tipo: 'B',  presentacion: 30, precio: 15000 },
  { codigo: 'A-30',  tipo: 'A',  presentacion: 30, precio: 18000 },
  { codigo: 'AA-30', tipo: 'AA', presentacion: 30, precio: 20000 },
  { codigo: 'B-15',  tipo: 'B',  presentacion: 15, precio: 8000  },
  { codigo: 'A-15',  tipo: 'A',  presentacion: 15, precio: 9500  },
  { codigo: 'AA-15', tipo: 'AA', presentacion: 15, precio: 10500 }
];

var USUARIOS_DEFAULT = [
  { usuario: 'Ivan',    nombre: 'Ivan',    rol: 'Administrador' },
  { usuario: 'Nelson',  nombre: 'Nelson',  rol: 'Vendedor' },
  { usuario: 'William', nombre: 'William', rol: 'Vendedor' },
  { usuario: 'Jorge',   nombre: 'Jorge',   rol: 'Vendedor' },
  { usuario: 'Leidy',   nombre: 'Leidy',   rol: 'Vendedor' },
  { usuario: 'Lyda',    nombre: 'Lyda',    rol: 'Vendedor' }
];

/* ============================ Punto de entrada ============================ */

function doGet(e) {
  var pathInfo = (e && e.pathInfo) ? String(e.pathInfo) : '';

  // Rutas auxiliares para PWA (manifest, iconos, service worker).
  if (pathInfo === 'sw.js') return serveServiceWorker();
  if (pathInfo === 'manifest.json') return serveManifest();
  if (pathInfo === 'icon.svg' || pathInfo === 'icon-192.svg' || pathInfo === 'icon-512.svg' || pathInfo === 'mask-icon.svg') return serveIcon();

  var template = HtmlService.createTemplateFromFile('index');
  template.appUrl = ScriptApp.getService().getUrl();
  return template.evaluate()
    .setTitle('HUEVOS FELICES LOS DIAMANTES')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ============================ Servicio de PWA ============================ */

function serveServiceWorker() {
  var content = HtmlService.createHtmlOutputFromFile('sw').getContent();
  return ContentService.createTextOutput(content).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function serveManifest() {
  var appUrl = ScriptApp.getService().getUrl();
  var manifest = {
    name: 'HUEVOS FELICES LOS DIAMANTES',
    short_name: 'Pedidos Huevos',
    description: 'Control de pedidos e inventario de la distribuidora de huevos.',
    start_url: appUrl,
    scope: appUrl + '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f5f5f4',
    theme_color: '#d97706',
    lang: 'es',
    icons: [
      { src: appUrl + '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
      { src: appUrl + '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
      { src: appUrl + '/mask-icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' }
    ]
  };
  return ContentService.createTextOutput(JSON.stringify(manifest)).setMimeType(ContentService.MimeType.JSON);
}

function serveIcon() {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
    + '<rect width="512" height="512" rx="96" fill="#d97706"/>'
    + '<ellipse cx="256" cy="300" rx="140" ry="172" fill="#ffffff"/>'
    + '<ellipse cx="256" cy="300" rx="140" ry="172" fill="none" stroke="#e7e5e4" stroke-width="6"/>'
    + '<ellipse cx="208" cy="228" rx="40" ry="58" fill="#fef3c7" opacity="0.9"/>'
    + '</svg>';
  return ContentService.createTextOutput(svg).setMimeType('image/svg+xml');
}

/* ============================ API JSON (para PWA / hosting externo) ============================
 * El frontend estático (GitHub Pages, etc.) llama a doPost con Content-Type text/plain
 * y un cuerpo JSON: { "action": "saveOrder", "args": [order, token] }.
 * Responde JSON: { "result": ... } o { "error": "mensaje" }.
 */

function doPost(e) {
  var out = ContentService.createTextOutput();
  try {
    var body = (e && e.postData && e.postData.contents) ? String(e.postData.contents) : '{}';
    var req = JSON.parse(body || '{}');
    var action = req.action;
    var args = (req.args && Array.isArray(req.args)) ? req.args : [];
    var result = dispatch(action, args);
    out.setContent(JSON.stringify({ result: result }));
  } catch (err) {
    out.setContent(JSON.stringify({ error: (err && err.message) ? err.message : String(err) }));
  }
  return out.setMimeType(ContentService.MimeType.JSON);
}

function dispatch(action, args) {
  switch (action) {
    case 'getLoginInfo':       return getLoginInfo();
    case 'login':              return login(args[0], args[1]);
    case 'logout':             return logout(args[0]);
    case 'getAppData':         return getAppData(args[0]);
    case 'saveClient':         return saveClient(args[0], args[1]);
    case 'updateClient':       return updateClient(args[0], args[1]);
    case 'saveOrder':          return saveOrder(args[0], args[1]);
    case 'updateOrder':        return updateOrder(args[0], args[1]);
    case 'toggleOrderState':   return toggleOrderState(args[0], args[1], args[2], args[3]);
    case 'registerPayment':    return registerPayment(args[0], args[1], args[2], args[3], args[4]);
    case 'saveProduccion':     return saveProduccion(args[0], args[1], args[2], args[3]);
    case 'saveAjuste':         return saveAjuste(args[0], args[1], args[2], args[3], args[4]);
    case 'updateProductPrices': return updateProductPrices(args[0], args[1]);
    case 'changePassword':     return changePassword(args[0], args[1]);
    case 'resetPassword':      return resetPassword(args[0], args[1]);
    default: throw new Error('Acción no válida: ' + action);
  }
}

/* ============================ Utilidades ============================ */

function getSS() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureSheetHeaders(sheet, expectedHeaders) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    sheet.setFrozenRows(1);
    return;
  }
  var existing = sheet.getRange(1, 1, 1, Math.min(lastCol, expectedHeaders.length)).getValues()[0];
  var needsFix = existing.length !== expectedHeaders.length;
  if (!needsFix) {
    for (var k = 0; k < expectedHeaders.length; k++) {
      if (existing[k] !== expectedHeaders[k]) { needsFix = true; break; }
    }
  }
  if (needsFix) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
  }
}

function getSheetData(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  var headers = values[0];
  var rows = [];
  var tz = getSS().getSpreadsheetTimeZone();
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var isEmpty = row.every(function(c) { return c === '' || c === null || c === undefined; });
    if (isEmpty) continue;
    var item = {};
    for (var j = 0; j < headers.length; j++) {
      var key = headers[j].toString();
      var value = row[j];
      if (value instanceof Date) {
        value = Utilities.formatDate(value, tz, 'yyyy-MM-dd');
      }
      item[key] = value;
    }
    rows.push(item);
  }
  return rows;
}

function findRowIndex(sheet, id, idColumnIndex) {
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idColumnIndex]) === String(id)) return r + 1;
  }
  return -1;
}

function hashPassword(password) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, HASH_SALT + ':' + password);
  return raw.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function computeEstadoPago(total, pagado) {
  total = Number(total) || 0;
  pagado = Number(pagado) || 0;
  if (total <= 0) return 'Pendiente';
  if (pagado >= total) return 'Pagado';
  if (pagado > 0) return 'Abono';
  return 'Pendiente';
}

/* ============================ Sesión / Autenticación ============================ */

function createSession(userObj) {
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put(SESSION_PREFIX + token, JSON.stringify(userObj), SESSION_TTL);
  return token;
}

function resolveUser(token) {
  if (!token) throw new Error('Sesión no válida. Inicia sesión de nuevo.');
  var raw = CacheService.getScriptCache().get(SESSION_PREFIX + token);
  if (!raw) throw new Error('Sesión expirada. Inicia sesión de nuevo.');
  return JSON.parse(raw);
}

function isAdmin(user) {
  return user && user.rol === 'Administrador';
}

function getLoginInfo() {
  var ss = getSS();
  var usersSheet = getOrCreateSheet(ss, 'Usuarios', HEADERS.Usuarios);
  ensureSheetHeaders(usersSheet, HEADERS.Usuarios);
  seedUsers(usersSheet);
  var users = getSheetData(usersSheet);
  var names = users.filter(function(u) { return u.Activo !== 'No'; })
    .map(function(u) { return u.Usuario; });
  return { usuarios: names };
}

function login(usuario, contrasena) {
  var ss = getSS();
  var usersSheet = getOrCreateSheet(ss, 'Usuarios', HEADERS.Usuarios);
  ensureSheetHeaders(usersSheet, HEADERS.Usuarios);
  seedUsers(usersSheet);

  if (!usuario || !contrasena) throw new Error('Ingresa usuario y contraseña.');
  var users = getSheetData(usersSheet);
  var found = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].Usuario) === String(usuario)) { found = users[i]; break; }
  }
  if (!found) throw new Error('Usuario o contraseña incorrectos.');
  if (found.Activo === 'No') throw new Error('Usuario inactivo.');
  if (hashPassword(contrasena) !== found.HashContrasena) {
    throw new Error('Usuario o contraseña incorrectos.');
  }

  var userObj = { usuario: found.Usuario, nombre: found.Nombre, rol: found.Rol };
  var token = createSession(userObj);
  return { token: token, user: userObj };
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove(SESSION_PREFIX + token);
  return true;
}

/* ============================ Siembra inicial ============================ */

function seedUsers(sheet) {
  var data = getSheetData(sheet);
  if (data.length > 0) return;
  USUARIOS_DEFAULT.forEach(function(u) {
    sheet.appendRow([
      Utilities.getUuid(), u.usuario, u.nombre, hashPassword(PASSWORD_DEFAULT), u.rol, 'Si'
    ]);
  });
}

function seedProducts(sheet) {
  var data = getSheetData(sheet);
  if (data.length > 0) return;
  PRODUCTOS_DEFAULT.forEach(function(p) {
    sheet.appendRow([p.codigo, p.tipo, p.presentacion, p.precio, 'Si']);
  });
}

/* ============================ Lectura de datos ============================ */

function readProducts() {
  var ss = getSS();
  var sheet = getOrCreateSheet(ss, 'Productos', HEADERS.Productos);
  ensureSheetHeaders(sheet, HEADERS.Productos);
  seedProducts(sheet);
  var data = getSheetData(sheet);
  return data.map(function(p) {
    return {
      codigo: p.Codigo,
      tipo: p.Tipo,
      presentacion: Number(p.Presentacion) || 0,
      precio: Number(p.Precio) || 0,
      activo: p.Activo
    };
  });
}

function getPriceMap() {
  var map = {};
  readProducts().forEach(function(p) { map[p.codigo] = p.precio; });
  return map;
}

function readOrdersWithItems() {
  var ss = getSS();
  var ordersSheet = getOrCreateSheet(ss, 'Pedidos', HEADERS.Pedidos);
  var detailSheet = getOrCreateSheet(ss, 'DetallePedidos', HEADERS.DetallePedidos);
  ensureSheetHeaders(ordersSheet, HEADERS.Pedidos);
  ensureSheetHeaders(detailSheet, HEADERS.DetallePedidos);

  var orders = getSheetData(ordersSheet);
  var details = getSheetData(detailSheet);
  var itemsByOrder = {};
  details.forEach(function(d) {
    if (!d.PedidoID) return;
    if (!itemsByOrder[d.PedidoID]) itemsByOrder[d.PedidoID] = [];
    itemsByOrder[d.PedidoID].push(d);
  });

  orders.forEach(function(o) {
    o.items = itemsByOrder[o.ID] || [];
    o.ValorTotal = Number(o.ValorTotal) || 0;
    o.ValorPagado = Number(o.ValorPagado) || 0;
    o.EstadoPago = computeEstadoPago(o.ValorTotal, o.ValorPagado);
  });
  return orders;
}

/* ============================ Datos de la app ============================ */

function getAppData(token) {
  var user = resolveUser(token);
  var ss = getSS();
  var clientsSheet = getOrCreateSheet(ss, 'Clientes', HEADERS.Clientes);
  ensureSheetHeaders(clientsSheet, HEADERS.Clientes);

  return {
    user: user,
    products: readProducts(),
    clients: getSheetData(clientsSheet),
    orders: readOrdersWithItems(),
    balance: getInventoryBalance()
  };
}

/* ============================ Clientes ============================ */

function saveClient(client, token) {
  var user = resolveUser(token);
  if (!client || !client.name) throw new Error('Ingresa el nombre del cliente.');

  var id = client.id || Utilities.getUuid();
  var existing = tryReadClientById(id);
  if (existing) return existing;

  var ss = getSS();
  var sheet = getOrCreateSheet(ss, 'Clientes', HEADERS.Clientes);
  ensureSheetHeaders(sheet, HEADERS.Clientes);
  var now = new Date();
  sheet.appendRow([id, client.name, client.address || '', client.phone || '', user.usuario, now]);

  return { ID: id, Nombre: client.name, Direccion: client.address || '', Telefono: client.phone || '', CreadoPor: user.usuario, FechaCreacion: formatDateStr(now) };
}

function updateClient(clientData, token) {
  var user = resolveUser(token);
  if (!clientData || !clientData.id || !clientData.name) throw new Error('Datos de cliente incompletos.');

  var ss = getSS();
  var sheet = getOrCreateSheet(ss, 'Clientes', HEADERS.Clientes);
  ensureSheetHeaders(sheet, HEADERS.Clientes);
  var values = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(clientData.id)) {
      rowIndex = r + 1;
      if (String(values[r][4]) !== String(user.usuario)) throw new Error('No puedes editar clientes de otros vendedores.');
      break;
    }
  }
  if (rowIndex === -1) throw new Error('Cliente no encontrado.');

  sheet.getRange(rowIndex, 2).setValue(clientData.name);
  sheet.getRange(rowIndex, 3).setValue(clientData.address || '');
  sheet.getRange(rowIndex, 4).setValue(clientData.phone || '');

  return { ID: clientData.id, Nombre: clientData.name, Direccion: clientData.address || '', Telefono: clientData.phone || '', CreadoPor: user.usuario, FechaCreacion: formatDateStr(values[rowIndex - 1][5]) };
}

/* ============================ Pedidos ============================ */

function saveOrder(order, token) {
  var user = resolveUser(token);
  if (!order || !order.clientId || !order.fechaEntrega) throw new Error('Datos de pedido incompletos.');
  var items = normalizeItems(order.items);
  if (items.length === 0) throw new Error('Agrega al menos un producto al pedido.');

  // Idempotencia: si el cliente envió un ID (creación offline) y ya existe, se devuelve sin duplicar.
  var id = order.id || Utilities.getUuid();
  var existing = tryReadOrderById(id);
  if (existing) return existing;

  var priceMap = getPriceMap();
  var total = 0;
  items.forEach(function(it) {
    if (!priceMap.hasOwnProperty(it.productoId)) throw new Error('Producto no válido: ' + it.productoId);
    it.precioUnitario = priceMap[it.productoId];
    it.subtotal = it.precioUnitario * it.cantidad;
    total += it.subtotal;
  });

  var ss = getSS();
  var ordersSheet = getOrCreateSheet(ss, 'Pedidos', HEADERS.Pedidos);
  var detailSheet = getOrCreateSheet(ss, 'DetallePedidos', HEADERS.DetallePedidos);
  ensureSheetHeaders(ordersSheet, HEADERS.Pedidos);
  ensureSheetHeaders(detailSheet, HEADERS.DetallePedidos);
  var now = new Date();
  var clientName = order.clientName || getClientNameById(order.clientId);
  var valorPagado = Number(order.valorPagado) || 0;

  ordersSheet.appendRow([
    id, user.usuario, order.clientId, clientName, order.fechaEntrega, total,
    order.metodoPago || 'Efectivo', valorPagado, order.alistado || 'No', order.entregado || 'No', now, now
  ]);

  items.forEach(function(it) {
    detailSheet.appendRow([id, it.productoId, it.cantidad, it.precioUnitario, it.subtotal]);
  });

  if (valorPagado > 0) {
    appendPayment(ss, id, valorPagado, order.metodoPago || 'Efectivo', user.usuario);
  }

  return readOrderById(id);
}

function updateOrder(order, token) {
  var user = resolveUser(token);
  if (!order || !order.id || !order.clientId || !order.fechaEntrega) throw new Error('Datos de pedido incompletos.');
  var items = normalizeItems(order.items);
  if (items.length === 0) throw new Error('Agrega al menos un producto al pedido.');

  var ss = getSS();
  var ordersSheet = getOrCreateSheet(ss, 'Pedidos', HEADERS.Pedidos);
  var detailSheet = getOrCreateSheet(ss, 'DetallePedidos', HEADERS.DetallePedidos);
  ensureSheetHeaders(ordersSheet, HEADERS.Pedidos);
  ensureSheetHeaders(detailSheet, HEADERS.DetallePedidos);

  var values = ordersSheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(order.id)) {
      rowIndex = r + 1;
      if (String(values[r][1]) !== String(user.usuario)) throw new Error('No puedes editar pedidos de otros vendedores.');
      break;
    }
  }
  if (rowIndex === -1) throw new Error('Pedido no encontrado.');

  var priceMap = getPriceMap();
  var total = 0;
  items.forEach(function(it) {
    if (!priceMap.hasOwnProperty(it.productoId)) throw new Error('Producto no válido: ' + it.productoId);
    it.precioUnitario = priceMap[it.productoId];
    it.subtotal = it.precioUnitario * it.cantidad;
    total += it.subtotal;
  });

  var now = new Date();
  var clientName = order.clientName || getClientNameById(order.clientId);
  var valorPagado = Number(order.valorPagado) || 0;

  ordersSheet.getRange(rowIndex, 3).setValue(order.clientId);
  ordersSheet.getRange(rowIndex, 4).setValue(clientName);
  ordersSheet.getRange(rowIndex, 5).setValue(order.fechaEntrega);
  ordersSheet.getRange(rowIndex, 6).setValue(total);
  ordersSheet.getRange(rowIndex, 7).setValue(order.metodoPago || 'Efectivo');
  ordersSheet.getRange(rowIndex, 9).setValue(order.alistado || 'No');
  ordersSheet.getRange(rowIndex, 10).setValue(order.entregado || 'No');
  ordersSheet.getRange(rowIndex, 12).setValue(now);

  deleteOrderDetails(order.id);
  items.forEach(function(it) {
    detailSheet.appendRow([order.id, it.productoId, it.cantidad, it.precioUnitario, it.subtotal]);
  });

  return readOrderById(order.id);
}

function toggleOrderState(orderId, field, value, token) {
  var user = resolveUser(token);
  if (field !== 'Alistado' && field !== 'Entregado') throw new Error('Campo no permitido.');

  var ss = getSS();
  var sheet = getOrCreateSheet(ss, 'Pedidos', HEADERS.Pedidos);
  ensureSheetHeaders(sheet, HEADERS.Pedidos);
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var colIndex = headers.indexOf(field);
  var modIndex = headers.indexOf('UltimaModificacion');
  var rowIndex = -1;

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(orderId)) {
      rowIndex = r + 1;
      if (String(values[r][1]) !== String(user.usuario)) throw new Error('No puedes modificar pedidos de otros vendedores.');
      break;
    }
  }
  if (rowIndex === -1) throw new Error('Pedido no encontrado.');

  sheet.getRange(rowIndex, colIndex + 1).setValue(value);
  if (modIndex !== -1) sheet.getRange(rowIndex, modIndex + 1).setValue(new Date());

  return readOrderById(orderId);
}

function registerPayment(pedidoId, valor, metodo, token, requestId) {
  var user = resolveUser(token);
  valor = Number(valor) || 0;
  if (valor <= 0) throw new Error('Ingresa un valor de abono mayor a 0.');

  var idemCache = CacheService.getScriptCache();
  var idemKey = requestId ? ('idem_pago_' + requestId) : null;
  if (idemKey && idemCache.get(idemKey)) return readOrderById(pedidoId);

  var ss = getSS();
  var sheet = getOrCreateSheet(ss, 'Pedidos', HEADERS.Pedidos);
  ensureSheetHeaders(sheet, HEADERS.Pedidos);
  var values = sheet.getDataRange().getValues();
  var rowIndex = -1;
  var currentPaid = 0;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(pedidoId)) {
      rowIndex = r + 1;
      if (String(values[r][1]) !== String(user.usuario)) throw new Error('No puedes cobrar pedidos de otros vendedores.');
      currentPaid = Number(values[r][7]) || 0;
      break;
    }
  }
  if (rowIndex === -1) throw new Error('Pedido no encontrado.');

  appendPayment(ss, pedidoId, valor, metodo || 'Efectivo', user.usuario);
  sheet.getRange(rowIndex, 8).setValue(currentPaid + valor);
  var modIndex = values[0].indexOf('UltimaModificacion');
  if (modIndex !== -1) sheet.getRange(rowIndex, modIndex + 1).setValue(new Date());

  if (idemKey) idemCache.put(idemKey, '1', 21600);
  return readOrderById(pedidoId);
}

function appendPayment(ss, pedidoId, valor, metodo, usuario) {
  var sheet = getOrCreateSheet(ss, 'Pagos', HEADERS.Pagos);
  ensureSheetHeaders(sheet, HEADERS.Pagos);
  sheet.appendRow([Utilities.getUuid(), pedidoId, new Date(), valor, metodo, usuario]);
}

function normalizeItems(items) {
  var result = [];
  if (!Array.isArray(items)) return result;
  items.forEach(function(it) {
    var qty = Number(it.cantidad) || 0;
    if (it.productoId && qty > 0) {
      result.push({ productoId: it.productoId, cantidad: qty });
    }
  });
  return result;
}

function deleteOrderDetails(orderId) {
  var ss = getSS();
  var sheet = getOrCreateSheet(ss, 'DetallePedidos', HEADERS.DetallePedidos);
  var values = sheet.getDataRange().getValues();
  var header = values[0];
  var kept = [];
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) !== String(orderId)) kept.push(values[i]);
  }
  sheet.clear();
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (kept.length > 0) sheet.getRange(2, 1, kept.length, header.length).setValues(kept);
}

function getClientNameById(clientId) {
  var ss = getSS();
  var sheet = getOrCreateSheet(ss, 'Clientes', HEADERS.Clientes);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(clientId)) return values[i][1];
  }
  return '';
}

function readOrderById(id) {
  var order = tryReadOrderById(id);
  if (!order) throw new Error('Pedido no encontrado.');
  return order;
}

function tryReadOrderById(id) {
  var orders = readOrdersWithItems();
  for (var i = 0; i < orders.length; i++) {
    if (String(orders[i].ID) === String(id)) return orders[i];
  }
  return null;
}

function tryReadClientById(id) {
  var ss = getSS();
  var sheet = getOrCreateSheet(ss, 'Clientes', HEADERS.Clientes);
  ensureSheetHeaders(sheet, HEADERS.Clientes);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      var row = values[i];
      return {
        ID: row[0],
        Nombre: row[1],
        Direccion: row[2],
        Telefono: row[3],
        CreadoPor: row[4],
        FechaCreacion: (row[5] instanceof Date) ? formatDateStr(row[5]) : row[5]
      };
    }
  }
  return null;
}

/* ============================ Inventario ============================ */

function saveProduccion(fecha, items, token, requestId) {
  var user = resolveUser(token);

  var idemCache = CacheService.getScriptCache();
  var idemKey = requestId ? ('idem_prod_' + requestId) : null;
  if (idemKey && idemCache.get(idemKey)) return getInventoryBalance();

  var clean = [];
  items.forEach(function(it) {
    var qty = Number(it.cantidad) || 0;
    if (it.productoId && qty > 0) clean.push({ productoId: it.productoId, cantidad: qty });
  });
  if (clean.length === 0) throw new Error('Ingresa al menos una cantidad de producción.');

  var ss = getSS();
  var sheet = getOrCreateSheet(ss, 'Inventario', HEADERS.Inventario);
  ensureSheetHeaders(sheet, HEADERS.Inventario);
  var now = new Date();
  clean.forEach(function(it) {
    sheet.appendRow([Utilities.getUuid(), fecha, it.productoId, 'Produccion', it.cantidad, user.usuario, now]);
  });
  if (idemKey) idemCache.put(idemKey, '1', 21600);
  return getInventoryBalance();
}

function saveAjuste(fecha, productoId, cantidad, token, requestId) {
  var user = resolveUser(token);
  if (!isAdmin(user)) throw new Error('Solo el administrador puede hacer ajustes de inventario.');
  cantidad = Number(cantidad) || 0;
  if (!productoId || cantidad === 0) throw new Error('Ajuste inválido.');

  var idemCache = CacheService.getScriptCache();
  var idemKey = requestId ? ('idem_ajuste_' + requestId) : null;
  if (idemKey && idemCache.get(idemKey)) return getInventoryBalance();

  var ss = getSS();
  var sheet = getOrCreateSheet(ss, 'Inventario', HEADERS.Inventario);
  ensureSheetHeaders(sheet, HEADERS.Inventario);
  sheet.appendRow([Utilities.getUuid(), fecha, productoId, 'Ajuste', cantidad, user.usuario, new Date()]);
  if (idemKey) idemCache.put(idemKey, '1', 21600);
  return getInventoryBalance();
}

function getInventoryBalance() {
  var products = readProducts();
  var ss = getSS();
  var invSheet = getOrCreateSheet(ss, 'Inventario', HEADERS.Inventario);
  ensureSheetHeaders(invSheet, HEADERS.Inventario);
  var invData = getSheetData(invSheet);

  var inventariado = {};
  products.forEach(function(p) { inventariado[p.codigo] = 0; });
  invData.forEach(function(row) {
    var code = row.ProductoID;
    var qty = Number(row.Cantidad) || 0;
    if (inventariado.hasOwnProperty(code)) inventariado[code] += qty;
    else inventariado[code] = qty;
  });

  var orders = readOrdersWithItems();
  var pendiente = {};
  products.forEach(function(p) { pendiente[p.codigo] = 0; });
  orders.forEach(function(o) {
    if (o.Entregado === 'Si') return;
    (o.items || []).forEach(function(it) {
      var code = it.ProductoID;
      if (pendiente.hasOwnProperty(code)) pendiente[code] += (Number(it.Cantidad) || 0);
    });
  });

  var balance = {};
  products.forEach(function(p) {
    var inv = inventariado[p.codigo] || 0;
    var pend = pendiente[p.codigo] || 0;
    balance[p.codigo] = {
      productoId: p.codigo,
      tipo: p.tipo,
      presentacion: p.presentacion,
      precio: p.precio,
      inventariado: inv,
      pedidos: pend,
      disponible: inv - pend
    };
  });
  return balance;
}

/* ============================ Configuración ============================ */

function updateProductPrices(items, token) {
  var user = resolveUser(token);
  if (!isAdmin(user)) throw new Error('Solo el administrador puede editar precios.');

  var ss = getSS();
  var sheet = getOrCreateSheet(ss, 'Productos', HEADERS.Productos);
  ensureSheetHeaders(sheet, HEADERS.Productos);
  var values = sheet.getDataRange().getValues();

  items.forEach(function(it) {
    var precio = Number(it.precio);
    if (!it.codigo || precio <= 0) return;
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][0]) === String(it.codigo)) {
        sheet.getRange(r + 1, 4).setValue(precio);
        break;
      }
    }
  });
  return readProducts();
}

function changePassword(nuevaContrasena, token) {
  var user = resolveUser(token);
  if (!nuevaContrasena || String(nuevaContrasena).length < 4) {
    throw new Error('La contraseña debe tener al menos 4 caracteres.');
  }
  var ss = getSS();
  var sheet = getOrCreateSheet(ss, 'Usuarios', HEADERS.Usuarios);
  ensureSheetHeaders(sheet, HEADERS.Usuarios);
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][1]) === String(user.usuario)) {
      sheet.getRange(r + 1, 4).setValue(hashPassword(nuevaContrasena));
      return true;
    }
  }
  throw new Error('Usuario no encontrado.');
}

function resetPassword(usuario, token) {
  var user = resolveUser(token);
  if (!isAdmin(user)) throw new Error('Solo el administrador puede restablecer contraseñas.');
  var ss = getSS();
  var sheet = getOrCreateSheet(ss, 'Usuarios', HEADERS.Usuarios);
  ensureSheetHeaders(sheet, HEADERS.Usuarios);
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][1]) === String(usuario)) {
      sheet.getRange(r + 1, 4).setValue(hashPassword(PASSWORD_DEFAULT));
      return true;
    }
  }
  throw new Error('Usuario no encontrado.');
}

/* ============================ Inicialización ============================ */

function initializeDatabase() {
  var ss = getSS();
  Object.keys(HEADERS).forEach(function(name) {
    getOrCreateSheet(ss, name, HEADERS[name]);
    ensureSheetHeaders(ss.getSheetByName(name), HEADERS[name]);
  });
  seedUsers(ss.getSheetByName('Usuarios'));
  seedProducts(ss.getSheetByName('Productos'));
  return 'Base de datos inicializada. Hojas: Usuarios, Clientes, Productos, Pedidos, DetallePedidos, Inventario, Pagos. ' +
    'Usuarios (6) con contraseña por defecto "' + PASSWORD_DEFAULT + '".';
}

function formatDateStr(date) {
  return Utilities.formatDate(date, getSS().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
}
