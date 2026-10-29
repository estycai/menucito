---
title: Login y autenticación
date: 2026-10-28
tags: [menucito, arquitectura, auth]
---

# Login y autenticación

- **Librería:** Better Auth, corre en Workers con el adaptador de D1.
- **Métodos:** login con Google + email y contraseña.
- **Emails transaccionales:** Resend (plan gratis) para verificar la cuenta y recuperar la contraseña.
- **Quién se loguea:** solo los restaurantes. Los comensales no necesitan cuenta.
- **Por qué no Clerk/Auth0:** tienen planes gratis, pero agregan dependencia de un proveedor externo y pueden encarecerse al crecer.

Related: [Stack tecnológico](Stack-tecnologico.md) · [Modelo de datos](Modelo-de-datos.md)
