---
title: Stack tecnológico
date: 2026-10-28
tags: [menucito, arquitectura, stack]
---

# Stack tecnológico

| Pieza               | Tecnología                                                                             | Por qué                                                   |
| ------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Frontend de gestión | React + Vite + TypeScript, TanStack Query, React Hook Form + Zod, Tailwind + shadcn/ui | Stack conocido. Hosting gratis en Cloudflare Pages        |
| Landing             | Astro (estática) + Tailwind                                                            | Buen SEO, casi sin JavaScript, muy rápida                 |
| Menús públicos      | Astro SSR en Pages + isla Preact (~10 KB) para el carrito                              | Carga casi instantánea con 4G malo                        |
| Backend             | Cloudflare Workers + Hono + Zod                                                        | Gratis hasta 100k requests por día                        |
| Base de datos       | D1 (SQLite) + Drizzle ORM                                                              | 5 GB gratis. Multi-tenant con `restaurant_id`             |
| Storage             | R2 + caché de KV                                                                       | 10 GB gratis, sin costo por salida de datos               |
| Login               | Better Auth + Google + email y contraseña                                              | Gratis, corre en Workers con D1                           |
| Emails              | Resend (plan gratis)                                                                   | Verificación, recuperar contraseña, avisos de vencimiento |
| Pagos               | Mercado Pago Suscripciones + webhooks                                                  | Débito automático en pesos                                |
| Métricas            | Cloudflare Web Analytics                                                               | Gratis                                                    |
| Errores             | Sentry (plan gratis)                                                                   | Monitoreo                                                 |
| CI/CD               | GitHub Actions                                                                         | Despliegue automático                                     |
| Repo                | Monorepo pnpm + Turborepo, paquete `shared` con tipos y esquemas Zod                   | Front y back comparten validaciones                       |

## Por qué TypeScript y no .NET en el backend

.NET no corre en Cloudflare Workers. Mantenerlo en Azure implicaría pagar App Service y base de datos desde el primer día. Con TypeScript en todo el stack el costo queda en 0.

## Estructura del monorepo (propuesta)

```
menucito/
├── apps/
│   ├── admin/      # React + Vite (panel de gestión)
│   ├── web/        # Astro (landing + menús públicos)
│   └── api/        # Hono en Workers
└── packages/
    └── shared/     # tipos, esquemas Zod, utilidades (armado del mensaje de WA)
```

La landing y los menús públicos pueden compartir el mismo proyecto Astro, porque los dos son páginas públicas.

Related: [Arquitectura general](Arquitectura-general.md) · [Arquitectura del backend](Arquitectura-del-backend.md) · [Login y autenticación](Login-y-autenticacion.md) · [Storage e imágenes](Storage-e-imagenes.md) · [Pagos y suscripciones](Pagos-y-suscripciones.md)
