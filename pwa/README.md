# PWA — Pedidos de Huevos (GitHub Pages + Apps Script)

App móvil instalable (PWA) con base de datos local (IndexedDB), sincronización con
Google Sheets y operación sin conexión.

Arquitectura:

```
+------------------------------------------------------+
|  FRONTEND PWA (GitHub Pages)                         |
|  index.html · styles.css · app.js · sw.js · manifest |
+------------------------------------------------------+
              |  fetch POST (JSON, text/plain)
              v
+------------------------------------------------------+
|  BACKEND API (Google Apps Script, Code.gs)           |
|  doPost → dispatch → login/pedidos/clientes/...       |
+------------------------------------------------------+
              |  SpreadsheetApp
              v
+------------------------------------------------------+
|  BASE DE DATOS (Google Sheets)                       |
+------------------------------------------------------+
```

---

## Parte A — Publicar el backend (Apps Script)

1. Entra a https://script.google.com y crea un **nuevo proyecto**.
2. Borra el contenido del editor y pega el contenido de `../Code.gs`.
3. Añade los archivos del proyecto:
   - `appsscript.json` (contenido de `../appsscript.json`).
   - `sw.html` (contenido de `../sw.html`) — opcional si solo usas GitHub Pages, pero no estorba.
4. En el editor, en el selector de funciones ejecuta una vez **`initializeDatabase`** para
   crear las hojas (Usuarios, Clientes, Productos, Pedidos, DetallePedidos, Inventario, Pagos)
   y los 6 usuarios con contraseña por defecto `1234`.
5. Haz clic en **Implementar → Nueva implementación**:
   - Tipo: **Aplicación web**.
   - Ejecutar como: **Yo (tu cuenta)**.
   - Quién tiene acceso: **Cualquier persona** (Cualquier persona con el enlace).
6. Copia la URL de la implementación. Tiene esta forma:
   ```
   https://script.google.com/macros/s/XXXXX_EL_ID_XXXXX/exec
   ```
7. Guarda esa URL; la necesitas en el paso siguiente.

> Importante: cada vez que modifiques `Code.gs` debes crear una **nueva implementación**
> y actualizar la URL en `app.js` (o usar "Administrar implementaciones → Editar → Nueva versión").

---

## Parte B — Publicar el frontend en GitHub Pages

1. En GitHub crea un repositorio nuevo (público), por ejemplo `pedidos-huevos`.
2. Sube **todo el proyecto** (incluida la carpeta `pwa/` y la carpeta `.github/`):
   ```bash
   git clone https://github.com/TU_USUARIO/pedidos-huevos.git
   cp -r ./* pedidos-huevos/        # desde la raíz de este proyecto
   cd pedidos-huevos
   git add .
   git commit -m "PWA pedidos de huevos"
   git push
   ```
3. Edita `pwa/app.js` y reemplaza la línea:
   ```js
   const API_URL = 'https://script.google.com/macros/s/AQUI_EL_ID_DE_TU_IMPLEMENTACION/exec';
   ```
   por la URL que copiaste en el paso A.6.
4. En el repositorio: **Settings → Pages**:
   - Source: **GitHub Actions** (recomendado, ya incluye `.github/workflows/deploy.yml`
     que publica automáticamente la carpeta `pwa/` en cada `push`).
   - O bien Source **Deploy from a branch**, rama `main`, carpeta `/ (root)` (en ese caso
     sube el contenido de `pwa/` a la raíz y puedes borrar la carpeta `.github/`).
5. Con "GitHub Actions", el primer despliegue se ejecuta solo al hacer `push`. La URL
   aparece en **Settings → Pages** (o en la pestaña **Actions**), del tipo
   `https://TU_USUARIO.github.io/pedidos-huevos/`.
6. Abre esa URL en el teléfono. Deberías ver la app y, al recargar, la opción de
   **"Agregar a pantalla de inicio" / "Instalar app"**.

---

## Parte C — Opción Google Sites (solo incrustar, NO es PWA completa)

Google Sites **no permite** subir archivos propios ni registrar un service worker, así que
no se puede instalar como PWA real ni funcionar offline desde Sites. Solo sirve para
incrustar la app dentro de una página:

1. En Google Sites: **Insertar → Insertar → Código insertado (Embed) → Por URL**.
2. Pega la URL de tu web app de Apps Script (la del paso A.6) **o** la URL de GitHub Pages.
3. Google mostrará la app dentro de un iframe.

Limitaciones de esta opción:
- No hay instalación como app (service worker/manifest no aplican en el iframe).
- La operación offline por IndexedDB **sí** funciona dentro del iframe (es solo JavaScript),
  pero si cierras y reabres sin red, la página de Sites no cargará la app.
- El login y los datos siguen funcionando (hablan con Apps Script).

**Recomendación:** para tener la experiencia PWA completa, usa **GitHub Pages** (Parte B).

---

## Verificación rápida

- Usuario/contraseña inicial: cualquiera de `Ivan, Nelson, William, Jorge, Leidy, Lyda`
  con contraseña `1234`.
- Para probar el API desde la consola del navegador:
  ```js
  fetch('https://script.google.com/macros/s/TU_ID/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ action: 'getLoginInfo', args: [] })
  }).then(r => r.json()).then(console.log);
  ```
  Debe devolver `{ "result": { "usuarios": [...] } }`.

## Notas

- Si el navegador bloquea el POST por CORS, confirma que la implementación de Apps Script
  tiene acceso **"Cualquier persona"**. El frontend envía `Content-Type: text/plain` a
  propósito para evitar el *preflight* de CORS.
- Los íconos `maskable` usan `mask-512.png`; los demás son los PNG generados desde
  `icons/icon.svg` (puedes reemplazarlos por tu propio logo).
