# Requerimientos — App de Control de Pedidos e Inventario
## Distribuidora de Huevos · Google Apps Script (mobile-first)

| Campo | Valor |
| :--- | :--- |
| Documento | `req.md` |
| Versión | 1.0 |
| Fecha | 2026-09-23 |
| Estado | Borrador para validación |
| Plataforma | Google Apps Script (Web App) + Google Sheets como base de datos |
| Referencia previa | Proyecto `DistriEggs` (lecciones aprendidas y arquitectura base) |

---

## 1. Visión general

Aplicación web **mobile-first** construida sobre Google Apps Script para la **toma de pedidos, control de inventario y cobranza** de una distribuidora de huevos. La app debe ser **sencilla, rápida y efectiva**: pensada para que seis vendedores operen desde el celular durante la jornada, sin fricción, con datos siempre sincronizados en Google Sheets (fuente única de verdad).

> Principio rector: *"Menos clics, datos en tiempo real, cero datos perdidos."*

---

## 2. Objetivos

- **OBJ-01** Permitir a 6 vendedores iniciar sesión de forma simple y segura.
- **OBJ-02** Registrar pedidos de flanes de huevo por cliente, tipo y presentación, con cálculo automático de totales.
- **OBJ-03** Llevar el control de inventario de flanes producidos y su balance contra pedidos pendientes.
- **OBJ-04** Controlar la cobranza por pedido (estado de pago) e identificar saldos pendientes por cliente.
- **OBJ-05** Ofrecer reportes rápidos de ventas y pendientes (hoy, semana, mes).
- **OBJ-06** Garantizar que toda la información viva en Google Sheets y se sincronice automáticamente entre usuarios.

---

## 3. Alcance

**Incluido:** autenticación, gestión de clientes, catálogo de productos/precios, registro y edición de pedidos, inventario (producción y balance), cobranza/estado de pago, reportes básicos y configuración de precios.

**No incluido (ver §17):** facturación electrónica, geolocalización de rutas, multiempresa, integración con pasarelas de pago, operación sin conexión a internet.

---

## 4. Usuarios y roles

La app tendrá **exactamente 6 usuarios**. Cada uno accede con un **nombre de usuario y contraseña (PIN o clave)**.

| Rol | Descripción | Permisos |
| :--- | :--- | :--- |
| Vendedor (6 usuarios) | Toma pedidos, registra clientes, actualiza estados y cobros. | Crea/edita sus propios pedidos y clientes; ve pedidos y clientes de todos; NO puede editar pedidos ajenos. |
| Administrador (opcional, recae en uno de los 6) | Gestiona precios, inventario y reportes consolidados. | Además de lo anterior, configura precios y corrige/edita inventario. |

**Nombres esperados (referencia del negocio):** Ivan, Nelson, William, Jorge, Leidy, Lyda.

---

## 5. Glosario / dominio de negocio

| Término | Definición |
| :--- | :--- |
| **Flan** | Bandeja/empaque de huevos (también llamada "cubeta"). Presentaciones de **30 huevos** y **15 huevos**. |
| **Tipo / Calibre** | Clasificación comercial del flan: **B**, **A**, **AA**. |
| **Presentación** | Cantidad de huevos por flan: **30** o **15**. |
| **Pedido** | Solicitud de un cliente con uno o varios ítems (flanes) y fecha de entrega. |
| **Alistado** | Estado interno: el pedido ya fue preparado/armado (Sí/No). |
| **Entregado** | Estado: el pedido fue entregado al cliente (Sí/No). |
| **Cobranza** | Registro de lo pagado por el cliente y su método de pago. |
| **Inventario** | Conteo de flanes disponibles por tipo y presentación. |

---

## 6. Catálogo de productos y precios

Cada producto es la combinación **Tipo × Presentación**. Hay **6 productos** en total.

| Código | Tipo | Presentación | Precio (COP) | Nota |
| :--- | :--- | :--- | :--- | :--- |
| `B-30` | B | 30 huevos | **$16.000** | Confirmado |
| `A-30` | A | 30 huevos | **$18.000** | Confirmado |
| `AA-30` | AA | 30 huevos | **$20.000** | Confirmado |
| `B-15` | B | 15 huevos | $8.000 | Propuesto, **a confirmar** |
| `A-15` | A | 15 huevos | $9.500 | Propuesto, **a confirmar** |
| `AA-15` | AA | 15 huevos | $10.500 | Propuesto, **a confirmar** |

- Los precios **deben ser configurables** (no quemados en el código) en una hoja `Productos`/`Configuracion`.
- El cálculo de total es **siempre en el servidor** (`Cantidad × Precio`), nunca en el cliente, para evitar manipulación.
- Moneda: **pesos colombianos (COP)**, formato `$1.500` o `$15.000` con separador de miles.

---

## 7. Requerimientos funcionales (FR)

### 7.1 Autenticación y sesión

| ID | Requerimiento | Prioridad |
| :--- | :--- | :--- |
| FR-AUT-01 | La app debe mostrar una pantalla de inicio de sesión (usuario + contraseña/PIN). | Alta |
| FR-AUT-02 | Debe validar las credenciales contra la hoja `Usuarios`; la contraseña se almacena como hash (no en texto plano). | Alta |
| FR-AUT-03 | Debe soportar exactamente 6 cuentas de vendedor. | Alta |
| FR-AUT-04 | Debe mantener la sesión activa en el dispositivo y permitir "Cerrar sesión" explícitamente. | Alta |
| FR-AUT-05 | Debe mostrar el nombre del usuario autenticado en todo momento (barra superior). | Media |
| FR-AUT-06 | Debe denegar accesos no autenticados a datos y funciones (validación también en servidor). | Alta |

### 7.2 Gestión de clientes

| ID | Requerimiento | Prioridad |
| :--- | :--- | :--- |
| FR-CLI-01 | Debe permitir crear, listar y buscar clientes (nombre, teléfono, dirección). | Alta |
| FR-CLI-02 | El directorio de clientes es **compartido**: todos los vendedores ven y reutilizan los mismos clientes. | Alta |
| FR-CLI-03 | Debe incluir autocompletado/buscador al seleccionar un cliente en un pedido. | Alta |
| FR-CLI-04 | Debe evitar duplicados razonables (aviso si el nombre/teléfono ya existe). | Media |
| FR-CLI-05 | Debe registrar quién creó cada cliente y su fecha. | Media |

### 7.3 Registro de pedidos

| ID | Requerimiento | Prioridad |
| :--- | :--- | :--- |
| FR-PED-01 | Debe permitir crear un pedido con: cliente, fecha de entrega, ítems (tipo + presentación + cantidad) y método de pago. | Alta |
| FR-PED-02 | Debe soportar **múltiples ítems por pedido** (detalle del pedido). | Alta |
| FR-PED-03 | Debe calcular el total automáticamente en el servidor usando los precios configurados. | Alta |
| FR-PED-04 | Debe permitir editar un pedido **solo por su creador** (validación en servidor). | Alta |
| FR-PED-05 | Debe gestionar estados rápidos: **Alistado** (Sí/No) y **Entregado** (Sí/No) con toggles de un clic. | Alta |
| FR-PED-06 | Debe mostrar la lista de pedidos con filtros: por vendedor, por estado de entrega y por período (hoy/semana/mes). | Alta |
| FR-PED-07 | Debe permitir buscar pedidos por cliente o vendedor. | Media |
| FR-PED-08 | Debe guardar fecha de creación y última modificación de cada pedido. | Media |

### 7.4 Inventario / producción

| ID | Requerimiento | Prioridad |
| :--- | :--- | :--- |
| FR-INV-01 | Debe registrar la producción/entrada de flanes por **tipo y presentación** con fecha. | Alta |
| FR-INV-02 | Debe calcular el **balance automático** por producto: `Disponible = Producido − Pedidos pendientes (no entregados)`. | Alta |
| FR-INV-03 | Debe alertar visualmente cuando un producto queda en balance bajo o negativo. | Media |
| FR-INV-04 | Debe permitir corregir inventario (ajustes manuales) por parte del administrador. | Media |

### 7.5 Cobranza / pagos

| ID | Requerimiento | Prioridad |
| :--- | :--- | :--- |
| FR-PAG-01 | Debe registrar el **estado de pago** por pedido: `Pagado`, `Pendiente`, `Abono`. | Alta |
| FR-PAG-02 | Debe registrar el **método de pago** (Efectivo / Transferencia) y el **valor pagado**. | Alta |
| FR-PAG-03 | Debe calcular el **saldo pendiente** por pedido y consolidado por cliente. | Alta |
| FR-PAG-04 | Debe permitir registrar abonos parciales conservando el historial. | Media |
| FR-PAG-05 | Debe listar clientes con cartera pendiente (reporte de cobranza). | Media |

### 7.6 Reportes y dashboard

| ID | Requerimiento | Prioridad |
| :--- | :--- | :--- |
| FR-REP-01 | Dashboard con indicadores clave: ventas del día, pedidos pendientes, flanes por entregar, cartera por cobrar. | Alta |
| FR-REP-02 | Reporte de ventas por período (hoy, semana, mes) y por vendedor. | Media |
| FR-REP-03 | Reporte de unidades vendidas por producto (tipo × presentación). | Media |
| FR-REP-04 | Exportación/descarga de reportes a Google Sheets (o CSV). | Baja |

### 7.7 Configuración

| ID | Requerimiento | Prioridad |
| :--- | :--- | :--- |
| FR-CFG-01 | Debe permitir editar precios por producto (tipo × presentación). | Alta |
| FR-CFG-02 | Debe permitir gestionar usuarios (restablecer contraseña/PIN). | Media |
| FR-CFG-03 | Los cambios de configuración deben aplicar a todos los usuarios de inmediato. | Media |

---

## 8. Requerimientos no funcionales (NFR)

| ID | Requerimiento | Prioridad |
| :--- | :--- | :--- |
| NFR-01 | **Mobile-first**: la UI debe ser 100 % usable en pantallas de teléfono (≥ 360 px de ancho) y responsive en escritorio. | Alta |
| NFR-02 | **Rendimiento**: las operaciones frecuentes (lista de pedidos, toggles de estado) deben responder en < 2 s en condiciones normales. | Alta |
| NFR-03 | **Sincronización**: toda lectura/escritura consulta Google Sheets (fuente única de verdad); no debe depender de caché local permanente. | Alta |
| NFR-04 | **Seguridad**: validación de permisos y de datos siempre en el servidor; contraseñas con hash. | Alta |
| NFR-05 | **Usabilidad**: flujo de "nuevo pedido" completable en ≤ 3 pasos y < 1 minuto en celular. | Alta |
| NFR-06 | **Disponibilidad**: la app funciona con el acceso estándar de Google (sin servidor propio ni costos adicionales). | Media |
| NFR-07 | **Escalabilidad**: soporta cientos de pedidos/mes sin degradación usando `CacheService` y escrituras acotadas. | Media |
| NFR-08 | **Mantenibilidad**: código modular (server `.gs` + HTML/CSS/JS separados), con documentación mínima en el repo. | Media |
| NFR-09 | **Idioma**: interfaz en español; formato de moneda y fechas según Colombia. | Media |

---

## 9. Reglas de negocio (RN)

- **RN-01** El total de un pedido se calcula **solo en el servidor** como la suma de `Cantidad_i × Precio_i` de cada ítem.
- **RN-02** Un pedido **solo** puede ser editado por el vendedor que lo creó.
- **RN-03** El balance de inventario considera **pendientes** a los pedidos con `Entregado = "No"`.
- **RN-04** Un pedido "Pagado" se marca automáticamente cuando `ValorPagado >= ValorTotal`; si es menor y mayor que 0, es "Abono"; si es 0, "Pendiente".
- **RN-05** Los precios vigentes se toman de la configuración; un cambio de precio **no** reescribe pedidos ya creados (el total se congela al crear el pedido).
- **RN-06** El método de pago se registra como dato obligatorio al crear el pedido (o "Sin definir").

---

## 10. Modelo de datos (Google Sheets)

La base de datos es una hoja de cálculo con las siguientes hojas (creadas por `initializeDatabase()`).

### 10.1 `Usuarios`
| Columna | Tipo | Descripción |
| :--- | :--- | :--- |
| `ID` | Texto | Identificador único |
| `Usuario` | Texto | Nombre de usuario (login) |
| `Nombre` | Texto | Nombre mostrado |
| `HashContrasena` | Texto | Hash de la contraseña/PIN |
| `Rol` | Texto | `Vendedor` / `Administrador` |
| `Activo` | Booleano | Si puede iniciar sesión |

### 10.2 `Clientes`
| Columna | Tipo | Descripción |
| :--- | :--- | :--- |
| `ID` | Texto (UUID) | Identificador único |
| `Nombre` | Texto | Nombre del cliente |
| `Telefono` | Texto | Teléfono |
| `Direccion` | Texto | Dirección de entrega |
| `CreadoPor` | Texto | Vendedor que lo registró |
| `FechaCreacion` | Fecha/Hora | Fecha de creación |

### 10.3 `Productos` (catálogo + precio)
| Columna | Tipo | Descripción |
| :--- | :--- | :--- |
| `Codigo` | Texto | `B-30`, `A-30`, `AA-30`, `B-15`, `A-15`, `AA-15` |
| `Tipo` | Texto | `B`, `A`, `AA` |
| `Presentacion` | Número | `30` o `15` |
| `Precio` | Número | Precio en COP |
| `Activo` | Booleano | Si el producto está a la venta |

### 10.4 `Pedidos` (cabecera)
| Columna | Tipo | Descripción |
| :--- | :--- | :--- |
| `ID` | Texto (UUID) | Identificador único |
| `Vendedor` | Texto | Creador del pedido |
| `ClienteID` | Texto | Referencia al cliente |
| `ClienteNombre` | Texto | Nombre (desnormalizado) |
| `FechaEntrega` | Fecha | Fecha programada |
| `ValorTotal` | Número | Total calculado (servidor) |
| `MetodoPago` | Texto | Efectivo / Transferencia |
| `ValorPagado` | Número | Total abonado |
| `EstadoPago` | Texto | `Pagado` / `Pendiente` / `Abono` |
| `Alistado` | Texto | `Si` / `No` |
| `Entregado` | Texto | `Si` / `No` |
| `FechaCreacion` | Fecha/Hora | Creación |
| `UltimaModificacion` | Fecha/Hora | Último cambio |

### 10.5 `DetallePedidos` (ítems)
| Columna | Tipo | Descripción |
| :--- | :--- | :--- |
| `PedidoID` | Texto | Referencia al pedido |
| `ProductoID` | Texto | Código del producto (`B-30`, etc.) |
| `Cantidad` | Número | Flanes solicitados |
| `PrecioUnitario` | Número | Precio congelado al crear el pedido |
| `Subtotal` | Número | `Cantidad × PrecioUnitario` |

### 10.6 `Inventario` (movimientos)
| Columna | Tipo | Descripción |
| :--- | :--- | :--- |
| `ID` | Texto (UUID) | Identificador único |
| `Fecha` | Fecha | Fecha del movimiento |
| `ProductoID` | Texto | Código del producto |
| `TipoMovimiento` | Texto | `Produccion` / `Ajuste` |
| `Cantidad` | Número | Positivo (entrada) o negativo (ajuste) |
| `RegistradoPor` | Texto | Usuario que registró |

### 10.7 `Pagos` (historial de abonos)
| Columna | Tipo | Descripción |
| :--- | :--- | :--- |
| `ID` | Texto (UUID) | Identificador único |
| `PedidoID` | Texto | Referencia al pedido |
| `Fecha` | Fecha/Hora | Fecha del pago |
| `Valor` | Número | Monto abonado |
| `MetodoPago` | Texto | Efectivo / Transferencia |
| `RegistradoPor` | Texto | Usuario que registró |

> El **balance** por producto se calcula **al vuelo** (no se almacena): `SUM(Produccion + Ajustes) − SUM(cantidad de ítems en pedidos no entregados)`.

---

## 11. Arquitectura técnica

```
+------------------------------------------------------------+
|                    FRONTEND (mobile-first)                 |
|    index.html  +  styles.html (CSS)  +  script.html (JS)   |
+------------------------------------------------------------+
                             |  google.script.run
                             v
+------------------------------------------------------------+
|                    BACKEND (Code.gs)                       |
|   Auth · Clientes · Pedidos · Inventario · Pagos · Reportes |
+------------------------------------------------------------+
                             |  SpreadsheetApp + CacheService
                             v
+------------------------------------------------------------+
|              BASE DE DATOS (Google Sheets)                 |
|  Usuarios | Clientes | Productos | Pedidos | DetallePedidos |
|  Inventario | Pagos                                         |
+------------------------------------------------------------+
```

**Decisiones de diseño:**
- **`HtmlService` + `google.script.run`**: llamadas asíncronas del frontend al servidor.
- **Modularidad**: `include()` para separar HTML/CSS/JS; `Code.gs` con funciones por dominio.
- **Servidor como autoridad**: todas las validaciones, permisos y cálculos en `Code.gs`.
- **`CacheService`**: para datos de configuración (precios) y reducir lecturas repetidas.
- **UUID** generado en servidor para cada registro.
- **LockService** opcional para evitar escrituras concurrentes conflictivas en inventario.

---

## 12. Diseño UI/UX (mobile-first)

- **Login**: pantalla simple, centrada, con logo/color de marca y botón grande "Entrar".
- **Navegación inferior por pestañas** (patrón móvil): `Pedidos · Nuevo · Clientes · Inventario · Reportes`.
- **Barra superior fija**: nombre del vendedor, indicador de sincronización y botón de cerrar sesión.
- **Nuevo pedido**: buscador de cliente con autocompletado → selección de productos (tipo + presentación + cantidad) → total en vivo → confirmar.
- **Lista de pedidos**: tarjetas o filas con badges de estado (Alistado/Entregado) **clicables** (toggle rápido), filtros superiores.
- **Feedback**: spinner global en cada llamada, confirmaciones ("Pedido guardado"), y mensajes de error claros.
- **Estética**: limpia, colores cálidos (tema "granja"), tipografía legible (ej. Outfit), botones con área táctil ≥ 44 px.
- **Accesibilidad**: contraste adecuado y etiquetas en formularios.

---

## 13. Seguridad

- **Autenticación** por usuario/contraseña con hash (p. ej., `CryptoJS`/`Utilities.computeDigest` con sal).
- **Autorización en servidor**: cada función verifica la sesión y el permiso (p. ej., editar solo pedidos propios).
- **Validación de entradas**: tipos, rangos y cálculos de total siempre en el servidor.
- **Sin secretos en el cliente**: la lógica de precios/totales no es manipulable desde el frontend.
- **Despliegue** recomendado: `executeAs = USER_DEPLOYING`, acceso `ANYONE` **con** control de sesión interno (el login de la app restringe el acceso).
- **Ocultar columnas sensibles** (hashes) en Sheets o proteger la hoja `Usuarios`.

---

## 14. Sincronización y disponibilidad

- Google Sheets es la **fuente única de verdad**; cada interacción lee/escribe en tiempo real, por lo que todos los vendedores ven siempre la información más reciente.
- **Sin conexión**: Apps Script no soporta operación offline nativa. Estrategia: mantener la app en línea (requerimiento de red) y, en el futuro, cachear en `localStorage` solo lectura de datos previos con aviso "sin conexión".
- **Respaldo**: la propia hoja de cálculo queda versionada por Google (historial de revisiones); se recomienda un respaldo periódico manual/script.

---

## 15. Criterios de aceptación

1. Los 6 usuarios pueden iniciar sesión con sus credenciales; usuarios incorrectos son rechazados.
2. Un vendedor crea un pedido con 2 ítems (ej. `A-30` × 3 y `B-15` × 2) y el total se calcula correctamente en servidor.
3. Un vendedor **no** puede editar el pedido creado por otro.
4. El balance de inventario se actualiza automáticamente al registrar producción y al crear/entregar pedidos.
5. Al registrar un pago parcial, el pedido queda en estado `Abono` y su saldo pendiente se refleja en el reporte de cartera.
6. Los reportes (hoy/semana/mes) muestran ventas y unidades correctas.
7. La app es usable en un teléfono de 360 px sin desplazamiento horizontal.
8. Un cambio de precio en configuración aplica a nuevos pedidos sin alterar los históricos.

---

## 16. Plan de fases (roadmap)

| Fase | Entregable |
| :--- | :--- |
| **F1 — Base** | `initializeDatabase`, autenticación, catálogo de productos, CRUD de clientes. |
| **F2 — Pedidos** | Crear/editar pedidos con detalle, cálculo en servidor, estados y filtros. |
| **F3 — Inventario** | Registro de producción, balance automático por producto. |
| **F4 — Cobranza** | Estado de pago, abonos, reporte de cartera. |
| **F5 — Reportes y pulido** | Dashboard, reportes por período/vendedor, exportación, UX final. |

---

## 17. Fuera de alcance (v1)

- Facturación electrónica (DIAN) e impresión de facturas.
- Geolocalización, rutas de reparto y mapas.
- Integración con pasarelas de pago (Nequi, Daviplata, etc.).
- Operación 100 % offline / PWA con sincronización por cola.
- Múltiples empresas/sucursales.
- Control de producción de la granja (solo registro de flanes listos para venta).

---

## 18. Riesgos y mitigaciones

| Riesgo | Mitigación |
| :--- | :--- |
| Cuotas de Apps Script (lecturas/escrituras, tiempo de ejecución). | Escrituras acotadas por operación, `CacheService`, paginación de listas. |
| Concurrencia al registrar inventario. | `LockService` en operaciones de ajuste crítico. |
| Precios de la presentación de 15 huevos sin confirmar. | Dejarlos configurables; confirmar con el negocio antes del cierre de F2. |
| Pérdida de datos por error humano. | Historial de revisiones de Google Sheets + confirmaciones en UI. |

---

## 19. Referencias

- Proyecto previo `DistriEggs` (archivos `Code.gs`, `index.html`, `styles.html`, `script.html`, `walkthrough.md`): arquitectura base y lecciones aprendidas reutilizables.
- Documentación oficial de Google Apps Script: `HtmlService`, `SpreadsheetApp`, `CacheService`, `LockService`.
