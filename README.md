# FerreControl

Gestión de ferretería con asistente por voz: inventario, ventas, caja, cotizaciones, clientes (fiados), pedidos a proveedores, reportes por perfil y finanzas.

## Estructura
- `public/` — la aplicación (un solo `index.html`, íconos y la librería de PDF).
- `netlify/functions/api.mts` — servidor: registro con código de invitación, ingreso (ferretería + usuario + contraseña) y datos separados por ferretería.
- `netlify/database/migrations/` — tablas de la base de datos (Netlify Database).

## Variables de entorno en Netlify
- `TOKEN_SECRET` — firma de las sesiones.
- `ADMIN_KEY` — clave maestra del proveedor para generar códigos de invitación (panel en `/#proveedor`).

## Perfiles
Administrador, Vendedor, Bodega y Caja.
