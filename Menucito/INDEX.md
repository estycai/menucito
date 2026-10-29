---
title: Menucito
date: 2026-10-28
tags: [menucito, index]
---

# Menucito

SaaS para restaurantes argentinos: cargan su menú, el cliente arma el pedido y lo envía por WhatsApp con el pedido ya escrito. Objetivo: ser la opción más barata del mercado.

## Mercado

- [Competencia en Argentina](01-mercado/Competencia-Argentina.md): quiénes hacen lo mismo, cuánto cobran y dónde está la oportunidad.

## Negocio

- [Planes y precios](02-negocio/Planes-y-precios.md): plan de 2 USD y de 5 USD netos, cálculo con comisiones de Mercado Pago y qué incluye cada uno.
- [Próximos pasos](02-negocio/Proximos-pasos.md): qué falta decidir y por dónde arrancar.

## Arquitectura

- [Arquitectura general](03-arquitectura/Arquitectura-general.md): diagrama de piezas, dominios y la decisión del menú publicado en KV.
- [Stack tecnológico](03-arquitectura/Stack-tecnologico.md): tecnología elegida para cada pieza y por qué.
- [Arquitectura del backend](03-arquitectura/Arquitectura-del-backend.md): API REST en capas (routes, services, repositories) y sus reglas.
- [Menú público y WhatsApp](03-arquitectura/Menu-publico-y-WhatsApp.md): cómo funciona el menú del comensal y el link `wa.me`.
- [Login y autenticación](03-arquitectura/Login-y-autenticacion.md): Better Auth, Google y emails.
- [Pagos y suscripciones](03-arquitectura/Pagos-y-suscripciones.md): Mercado Pago Suscripciones, webhooks y actualización de precios.
- [Storage e imágenes](03-arquitectura/Storage-e-imagenes.md): R2 y compresión de fotos en el navegador.
- [Modelo de datos](03-arquitectura/Modelo-de-datos.md): tablas iniciales en D1.
- [Personalización de ingredientes](03-arquitectura/Personalizacion-de-ingredientes.md): cantidad incluida, mínimo, máximo y costo por unidad extra (ej: bacon x2).
- [Infraestructura y costos](03-arquitectura/Infraestructura-y-costos.md): límites del plan gratis de Cloudflare y costos fijos.

## Referencias

- [Fuentes](04-referencias/Fuentes.md): todos los links consultados.
