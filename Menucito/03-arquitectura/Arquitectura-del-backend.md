---
title: Arquitectura del backend
date: 2026-10-28
tags: [menucito, arquitectura, backend, api]
---

# Arquitectura del backend

Regla fija para `apps/api`: **API REST en capas**. Todo endpoint nuevo se parte en estas capas, aunque sea chico.

```
apps/api/src/
├── routes/        # Hono: validan con Zod, llaman al service, devuelven JSON
├── services/      # lógica de negocio (ej: crear restaurante y validar el slug)
├── repositories/  # acceso a D1 con Drizzle
├── middleware/    # requireSession, tenant (restaurant_id)
└── db/schema.ts
```

## Reglas

- **Sin controllers como clases.** En Hono el handler de la ruta ya cumple ese rol.
- **Dependencias en un solo sentido:** `routes → services → repositories`. Una capa no llama a la de arriba.
- **Validación:** los esquemas Zod y los tipos viven en `packages/shared`, así front y back comparten las mismas reglas.
- **Multi-tenant:** todo repository filtra por `restaurant_id`, que llega desde el middleware de tenant y nunca desde el body del request.
- **Excepción:** los endpoints `/api/auth/*` los provee Better Auth. No se escriben a mano.

## Estado actual

Hoy `apps/api` solo tiene `/health` y Better Auth montado en `/api/auth/*`. Las capas se crean con el primer endpoint propio (crear restaurante).

## Por qué con repositories

Con pocos endpoints son una capa extra. Se eligieron igual para que el acceso a D1 quede aislado y los services se puedan testear sin base. La variante liviana (`routes + services` con Drizzle directo) quedó descartada.

Related: [Stack tecnológico](Stack-tecnologico.md) · [Arquitectura general](Arquitectura-general.md) · [Modelo de datos](Modelo-de-datos.md) · [Login y autenticación](Login-y-autenticacion.md)
