---
title: Modelo de datos
date: 2026-10-28
tags: [menucito, arquitectura, base-de-datos]
---

# Modelo de datos

Base: Cloudflare D1 (SQLite) con Drizzle ORM. Multi-tenant por `restaurant_id`.

```
users             (id, email, name, ...)                 ← Better Auth
restaurants       (id, owner_id, slug, name, whatsapp, logo_url, colors,
                   delivery, takeaway, hours_json, plan, status)
categories        (id, restaurant_id, name, position)
products          (id, restaurant_id, category_id, name, description,
                   price_cents, image_url, available, position)
ingredients       (id, product_id, name, included_qty, min_qty,
                   max_qty, extra_price, position)        ← Pro: ej: Bacon incluye 1, +$1.500 c/u extra
option_groups     (id, product_id, name, min, max)        ← ej: "Punto de la carne"
options           (id, group_id, name, price_delta)
subscriptions     (id, restaurant_id, mp_preapproval_id, plan, status,
                   amount_ars, next_payment_at)
payments          (id, subscription_id, mp_payment_id, amount, status, paid_at)
order_events      (id, restaurant_id, total, items_count, created_at)  ← estadísticas Pro
```

## Notas

- Estado actual: `restaurants` existe con `id, owner_id (único), slug (único), name, whatsapp, delivery, takeaway, logo_url, plan, status, created_at, updated_at`. `logo_url` guarda la ruta pública del logo o `NULL` (ver [Storage e imágenes](Storage-e-imagenes.md)). `colors` y `hours_json` todavía no están (se agregan en cambios posteriores). `whatsapp` se guarda normalizado (`549` + característica + número).

- Estado actual: `categories` y `products` existen (migración `0003_catalog`), ver `docs/changes/04-menu-catalog.md`.
  - `categories`: `id, restaurant_id, name, position, created_at, updated_at`. Índice `(restaurant_id, position)`. El nombre es único por local sin distinguir mayúsculas (índice único sobre `(restaurant_id, lower(name))`). SQLite `lower()` solo pasa a minúscula letras ASCII: dos nombres que difieren solo en una letra acentuada en mayúscula/minúscula (por ejemplo "Ñoquis" y "ñoquis") se aceptan como distintos.
  - `products`: `id, restaurant_id, category_id, name, description, price_cents, image_url, available, position, created_at, updated_at`. Índice `(restaurant_id, category_id, position)`.
  - `position` empieza en 0: por local para las categorías y por categoría para los productos. Las listas se ordenan por `position` y después por `created_at`. Lo nuevo (y un producto que cambia de categoría) va al final. Reordenar reescribe `0..n-1` en un solo batch; después de borrar pueden quedar huecos y no pasa nada.
  - `available = false` es "Agotado". Todavía no existe "oculto".
  - Borrar una categoría con productos está **bloqueado** (409 `CATEGORY_NOT_EMPTY`, y además `on delete restrict` en la base). Se descartó el borrado en cascada: con un clic se perderían muchos productos y sus fotos.
- Diferencias con el modelo planeado:
  - `price` pasó a `price_cents`: entero en centavos de ARS. Sin redondeos de punto flotante; el total del pedido por WhatsApp y los montos de Mercado Pago suman exacto.
  - `image_url` guarda **una** foto por producto (la ruta pública; la clave de R2 se deriva de ella).
  - `description` es NOT NULL con valor por defecto `''`.
- Límites del plan: solo en `packages/shared/src/plans.ts`. Básico: hasta 40 productos y fotos incluidas; Pro: productos ilimitados. Sin límite de categorías. Solo se limita la creación de productos.

- Los pedidos no pasan por el servidor: van directo a WhatsApp. `order_events` guarda solo un evento anónimo para estadísticas.
- Los ingredientes con cantidad incluida y costo por unidad extra se explican en [Personalización de ingredientes](Personalizacion-de-ingredientes.md).
- El menú público no lee estas tablas: lee el JSON publicado en KV (ver [Arquitectura general](Arquitectura-general.md)).

Related: [Arquitectura general](Arquitectura-general.md) · [Pagos y suscripciones](Pagos-y-suscripciones.md) · [Login y autenticación](Login-y-autenticacion.md) · [Personalización de ingredientes](Personalizacion-de-ingredientes.md)
