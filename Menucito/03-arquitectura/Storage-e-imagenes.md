---
title: Storage e imágenes
date: 2026-10-28
tags: [menucito, arquitectura, storage]
---

# Storage e imágenes

- **Dónde:** Cloudflare R2 (10 GB gratis, sin costo por salida de datos).
- **Compresión en el navegador:** antes de subir, la imagen se redimensiona y se convierte a WebP con un `<canvas>` propio (`createImageBitmap`/`<img>` + `canvas.toBlob`), sin librerías de terceros. Así no hace falta pagar Cloudflare Images.
- **Subida (logo, decidido):** el navegador manda el WebP ya comprimido al Worker (`PUT /api/restaurants/me/logo`, multipart) y el Worker lo escribe en R2. Se descartó la URL firmada para el logo: necesita credenciales de la API S3 de R2 y no funciona con el emulador local, y un logo de 512x512 pesa muy poco.
- **Subida (fotos de productos, a definir):** se vuelve a evaluar la URL firmada (subida directa a R2) cuando lleguen las fotos.
- **Entrega:** por ahora el Worker sirve los archivos en `GET /api/media/*` (público, `image/webp`, caché de un año `immutable`, `X-Content-Type-Options: nosniff`). Más adelante, dominio propio sobre R2 con caché del CDN.
- **Bucket y claves:** binding `MEDIA` (bucket `menucito-media`). Clave `logos/<restaurantId>/<aleatorio>.webp`: nombre nuevo en cada subida, así la caché nunca queda vieja. En la base se guarda solo la ruta pública (`restaurants.logo_url`) y la clave se deriva de ella. En local R2 lo emula Miniflare (`wrangler dev --local`), sin cuenta de Cloudflare.
- **Límites por plan:** Básico 1 foto por producto; Pro ilimitado.
- **Logo del local:** lo pueden subir **todos los planes** (no es exclusivo del Pro, no hay chequeo de plan en el código). Acepta PNG, JPG, WebP, GIF o SVG; se normaliza en el navegador a WebP de 512x512 ("contain", relleno transparente). Los SVG se rasterizan con un `<img>` (sus scripts no se ejecutan) y el SVG original nunca se sube ni se sirve. El Worker valida tamaño (hasta 1 MB), `Content-Type: image/webp` y la firma `RIFF....WEBP`. Al reemplazar: primero escribe el nuevo, después actualiza la base y al final borra el anterior (si el borrado falla, solo se registra). Detalle en `docs/changes/03-logo-storage.md`.

Related: [Stack tecnológico](Stack-tecnologico.md) · [Infraestructura y costos](Infraestructura-y-costos.md)
