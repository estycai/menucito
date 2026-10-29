---
title: Pagos y suscripciones
date: 2026-10-28
tags: [menucito, arquitectura, pagos, mercadopago]
---

# Pagos y suscripciones

Cobro mensual a los restaurantes con **Mercado Pago Suscripciones** (API de suscripciones / débito automático).

## Flujo

1. Se crea un plan de suscripción en Mercado Pago por cada plan (Básico y Pro).
2. El restaurante se suscribe desde el panel.
3. El webhook de Mercado Pago llega a `api.tumarca.com.ar`, se valida la firma `x-signature` y se actualiza el estado en `subscriptions` y `payments`.
4. Si un pago falla: 5 días de gracia y aviso por email.
5. Pasada la gracia: se desactivan los pedidos (el menú sigue visible).

## Actualización de precios por inflación

- El precio se guarda en USD (2 y 5 USD netos).
- Un Cron Trigger de Workers toma la cotización (dolarapi.com o similar) y recalcula el monto en pesos.
- Se actualiza el monto de las suscripciones activas por API. Probar primero en sandbox.

## Comisiones

Ver el cálculo en [Planes y precios](../02-negocio/Planes-y-precios.md). Recomendación: liberar el dinero a 35 días (1,49% + IVA).

Related: [Planes y precios](../02-negocio/Planes-y-precios.md) · [Modelo de datos](Modelo-de-datos.md)
