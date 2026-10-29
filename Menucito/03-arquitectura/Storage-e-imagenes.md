---
title: Storage e imágenes
date: 2026-10-28
tags: [menucito, arquitectura, storage]
---

# Storage e imágenes

- **Dónde:** Cloudflare R2 (10 GB gratis, sin costo por salida de datos).
- **Compresión en el navegador:** antes de subir, la foto se redimensiona y se convierte a WebP (por ejemplo con `browser-image-compression`). Así no hace falta pagar Cloudflare Images.
- **Subida:** URL firmada generada por el backend; el navegador sube directo a R2.
- **Entrega:** dominio propio sobre R2 con caché del CDN.
- **Límites por plan:** Básico 1 foto por producto; Pro ilimitado.
- **Logo del local:** lo pueden subir **todos los planes** (no es exclusivo del Pro). Se normaliza en el navegador a WebP de 512x512, los SVG se rasterizan y la subida pasa por el Worker. Detalle en `docs/changes/03-logo-storage.md`.

Related: [Stack tecnológico](Stack-tecnologico.md) · [Infraestructura y costos](Infraestructura-y-costos.md)
