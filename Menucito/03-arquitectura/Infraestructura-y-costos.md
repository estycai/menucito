---
title: Infraestructura y costos
date: 2026-10-28
tags: [menucito, arquitectura, costos, cloudflare]
---

# Infraestructura y costos

## Límites del plan gratis de Cloudflare

Según un resumen de mayo de 2026; confirmar en la documentación oficial.

| Producto | Límite gratis |
|---|---|
| Workers | 100.000 requests por día, 30 ms de CPU por request |
| KV | 100.000 lecturas y 1.000 escrituras por día, 1 GB |
| D1 | 5 M lecturas de filas y 100.000 escrituras por día, 5 GB |
| R2 | 10 GB, 1 M operaciones clase A y 10 M clase B por mes, sin costo de salida |
| Pages | 500 builds por mes, ancho de banda sin tope para tráfico web normal |

Ojo con KV: 1.000 escrituras por día alcanza de sobra para publicar menús, pero no para guardar contadores en KV (por eso las estadísticas van a D1).

## Costos fijos

- **Dominio menucito.com (DonWeb):** $19.900 por año, precio visto en el carrito de DonWeb el 2026-10-28. Alternativa `.com.ar` en NIC Argentina (confirmar precio vigente).
- **Infraestructura:** $0 hasta superar el plan gratis. Después, Workers Paid a 5 USD por mes.
- **Mercado Pago:** solo la comisión por cobro, ya incluida en los precios.
- **Monotributo:** cuota fija mensual.

Related: [Arquitectura general](Arquitectura-general.md) · [Planes y precios](../02-negocio/Planes-y-precios.md)
