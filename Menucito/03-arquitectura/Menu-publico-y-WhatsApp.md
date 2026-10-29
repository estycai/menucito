---
title: Menú público y WhatsApp
date: 2026-10-28
tags: [menucito, arquitectura, whatsapp, frontend]
aliases: [Menú del comensal]
---

# Menú público y WhatsApp

## El link de WhatsApp (sin costo)

No se usa la API oficial de WhatsApp Business (cobra por conversación). Se usa un link:

```
https://wa.me/549XXXXXXXXXX?text=<mensaje codificado>
```

Formato del número en Argentina: `549` + código de área sin el 0 + número sin el 15. Ejemplo: 011 15 1234-5678 → `5491112345678`.

El mensaje se arma en el navegador y se codifica con `encodeURIComponent`.

## Flujo del comensal

1. Abre `tumarca.com.ar/{slug}` (por link o QR).
2. La página lee el JSON publicado en KV.
3. Agrega productos al carrito, con opciones, extras y ajuste de ingredientes (ver [Personalización de ingredientes](Personalizacion-de-ingredientes.md)).
4. Completa nombre, retiro o envío, dirección y forma de pago.
5. Toca "Enviar pedido": se abre WhatsApp con el pedido escrito.
6. Se registra un evento anónimo en `order_events` para las estadísticas (Pro).

## Ejemplo de mensaje

```
Hola! Quiero hacer un pedido:

2x Hamburguesa completa ($25.000)
   - Punto: a punto
   - Bacon x2 (+$1.500)
   - + Papas
1x Coca 1.5L ($3.500)

Total: $28.500
Envío a: Av. Siempre Viva 742
Pago: Transferencia
Nombre: Juan
```

## Tecnología

- Astro SSR en Cloudflare Pages.
- El carrito es una isla Preact (~10 KB).
- La función que arma el mensaje vive en `packages/shared` para testearla aparte.

Related: [Arquitectura general](Arquitectura-general.md) · [Modelo de datos](Modelo-de-datos.md) · [Personalización de ingredientes](Personalizacion-de-ingredientes.md)
