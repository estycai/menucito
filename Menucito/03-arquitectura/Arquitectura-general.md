---
title: Arquitectura general
date: 2026-10-28
tags: [menucito, arquitectura]
---

# Arquitectura general

Todo corre en Cloudflare para que el costo de infraestructura sea $0 hasta tener bastantes clientes. Cuando se supere el plan gratis, el plan pago de Workers cuesta 5 USD por mes: lo cubre un solo cliente Pro.

## Diagrama

```
tumarca.com.ar        → Landing (Astro, estática)
tumarca.com.ar/{slug} → Menú público (Astro SSR + isla Preact para el carrito)
app.tumarca.com.ar    → Panel de gestión (React SPA)
api.tumarca.com.ar    → Backend (Hono en Workers)
        ├── D1 (base de datos)
        ├── KV (copia publicada de cada menú)
        ├── R2 (imágenes)
        └── Cron (precios, vencimientos)
Mercado Pago ──webhook──→ api
```

## Multi-tenant

- Una sola app para todos los restaurantes. No hay un deploy por cliente.
- Cada restaurante tiene un `slug` único y su página en `tumarca.com.ar/{slug}`.
- Todas las tablas llevan `restaurant_id`.

## Decisión clave: menú publicado en KV

- Cada vez que el restaurante guarda cambios, el backend arma un JSON con el menú completo y lo guarda en KV.
- El menú público lee solo ese JSON, nunca consulta D1.
- Resultado: carga casi instantánea en el celular y casi cero lecturas a la base, aunque un menú tenga miles de visitas.

## Ciclo de vida de un restaurante

1. Se registra (login) y crea su restaurante.
2. Carga categorías, productos y opciones.
3. Publica: se genera el JSON en KV.
4. Comparte el link o el QR.
5. Se suscribe con Mercado Pago al terminar la prueba.
6. Si deja de pagar: 5 días de gracia, después se desactivan los pedidos (el menú sigue visible).

Related: [Stack tecnológico](Stack-tecnologico.md) · [Menú público y WhatsApp](Menu-publico-y-WhatsApp.md) · [Infraestructura y costos](Infraestructura-y-costos.md)
