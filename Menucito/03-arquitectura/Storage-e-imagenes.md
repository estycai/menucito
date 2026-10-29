---
title: Storage e imágenes
date: 2026-10-28
tags: [menucito, arquitectura, storage]
---

# Storage e imágenes

- **Dónde:** Cloudflare R2 (10 GB gratis, sin costo por salida de datos).
- **Compresión en el navegador:** antes de subir, la imagen se redimensiona y se convierte a WebP con un `<canvas>` propio (`createImageBitmap`/`<img>` + `canvas.toBlob`), sin librerías de terceros. Así no hace falta pagar Cloudflare Images.
- **Subida (logo, decidido):** el navegador manda el WebP ya comprimido al Worker (`PUT /api/restaurants/me/logo`, multipart) y el Worker lo escribe en R2. Se descartó la URL firmada para el logo: necesita credenciales de la API S3 de R2 y no funciona con el emulador local, y un logo de 512x512 pesa muy poco.
- **Subida (fotos de productos, decidido):** igual que el logo, el navegador manda el WebP al Worker (`PUT /api/products/:id/photo`, multipart) y el Worker lo escribe en R2. Se mantiene sin URL firmada por la misma razón (credenciales S3 y emulador local), y una foto de 800x800 en WebP pesa unos 50-150 KB.
- **Entrega:** por ahora el Worker sirve los archivos en `GET /api/media/*` (público, `image/webp`, caché de un año `immutable`, `X-Content-Type-Options: nosniff`). Más adelante, dominio propio sobre R2 con caché del CDN.
- **Bucket y claves:** binding `MEDIA` (bucket `menucito-media`). Claves `logos/<restaurantId>/<aleatorio>.webp` y `products/<restaurantId>/<aleatorio>.webp` (solo esos dos prefijos se sirven en público): nombre nuevo en cada subida, así la caché nunca queda vieja. En la base se guarda solo la ruta pública (`restaurants.logo_url`) y la clave se deriva de ella. En local R2 lo emula Miniflare (`wrangler dev --local`), sin cuenta de Cloudflare.
- **Límites por plan:** una foto por producto en todos los planes; las fotos de productos están incluidas en el Básico. Los valores viven solo en `packages/shared/src/plans.ts`.
- **Fotos de productos:** se normalizan en el navegador a WebP de 800x800 con "cover" (se escala hasta llenar el cuadrado y se recorta centrado). 800 cubre el banner de 390 px del detalle público con pantallas 2x, y "cover" evita bandas en fotos reales. Acepta PNG, JPG, WebP o GIF (sin SVG: una foto no es vector y así hay menos superficie de ataque). El input usa `accept="image/*"` sin `capture`, para que el celular ofrezca cámara y galería; lo que no se pueda leer (por ejemplo HEIC si el navegador no lo convierte) muestra "No pudimos leer esa imagen". Mismas validaciones y orden de reemplazo que el logo; al borrar el producto se borra su foto (si falla, solo se registra).
- **Logo del local:** lo pueden subir **todos los planes** (no es exclusivo del Pro, no hay chequeo de plan en el código). Acepta PNG, JPG, WebP, GIF o SVG; se normaliza en el navegador a WebP de 512x512 ("contain", relleno transparente). Los SVG se rasterizan con un `<img>` (sus scripts no se ejecutan) y el SVG original nunca se sube ni se sirve. El Worker valida tamaño (hasta 1 MB), `Content-Type: image/webp` y la firma `RIFF....WEBP`. Al reemplazar: primero escribe el nuevo, después actualiza la base y al final borra el anterior (si el borrado falla, solo se registra). Detalle en `docs/changes/03-logo-storage.md`.

Related: [Stack tecnológico](Stack-tecnologico.md) · [Infraestructura y costos](Infraestructura-y-costos.md)
