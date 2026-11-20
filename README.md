# FerreControl

Prototipo del cerebro por voz para una ferretería: inventario, ventas, cotizaciones, clientes (fiados), compras, proveedores, reportes por usuario y finanzas.

- Todo está en `index.html`; no necesita compilación.
- Los datos son de muestra y se guardan en el navegador (localStorage).
- La voz usa el reconocimiento del navegador, que exige HTTPS y permiso de micrófono (Chrome en computador o Android; Safari en iPhone).

## Publicar en Netlify
1. En Netlify: Add new site → Import an existing project → GitHub → este repositorio.
2. Deja vacío el comando de build; la carpeta de publicación es `.` (ya está en `netlify.toml`).
