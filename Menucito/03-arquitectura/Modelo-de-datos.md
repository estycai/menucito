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
                   price, image_url, available, position)
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

- Estado actual: `restaurants` existe con `id, owner_id (único), slug (único), name, whatsapp, delivery, takeaway, plan, status, created_at, updated_at`. `logo_url`, `colors` y `hours_json` todavía no están (se agregan en cambios posteriores). `whatsapp` se guarda normalizado (`549` + característica + número).

- Los pedidos no pasan por el servidor: van directo a WhatsApp. `order_events` guarda solo un evento anónimo para estadísticas.
- Los ingredientes con cantidad incluida y costo por unidad extra se explican en [Personalización de ingredientes](Personalizacion-de-ingredientes.md).
- El menú público no lee estas tablas: lee el JSON publicado en KV (ver [Arquitectura general](Arquitectura-general.md)).

Related: [Arquitectura general](Arquitectura-general.md) · [Pagos y suscripciones](Pagos-y-suscripciones.md) · [Login y autenticación](Login-y-autenticacion.md) · [Personalización de ingredientes](Personalizacion-de-ingredientes.md)
