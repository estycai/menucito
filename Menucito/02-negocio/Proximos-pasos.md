---
title: Próximos pasos
date: 2026-10-28
tags: [menucito, negocio, pendientes]
---

# Próximos pasos

## Para arrancar el desarrollo

1. Crear el monorepo (pnpm + Turborepo) con `apps/` y `packages/shared`.
2. Definir el esquema de D1 con Drizzle a partir del [Modelo de datos](../03-arquitectura/Modelo-de-datos.md).
3. Primer endpoint en Hono y despliegue en Workers.
4. Login con Better Auth.
5. CRUD de categorías y productos en el panel.
6. Generación del menú publicado en KV y página pública.
7. Integración con Mercado Pago Suscripciones (sandbox).
8. Landing.

## Decisiones pendientes

- Nombre definitivo y dominio `.com.ar` (confirmar precio en NIC Argentina).
- Límites exactos del plan Básico (cantidad de productos, fotos).
- Frecuencia de actualización del precio en pesos (mensual o trimestral).
- Duración de la prueba gratis.
- Si conviene ofrecer un plan gratis con límites para competir con Pídeme.
- Inscripción en monotributo.

Related: [Planes y precios](Planes-y-precios.md) · [Arquitectura general](../03-arquitectura/Arquitectura-general.md)
