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

## Estado actual: lectura a través de la API (hasta que exista KV)

Decisión de la spec 08: el menú público todavía **no** se lee de KV. La app web (`apps/web`, Astro SSR) pide el menú desde el servidor a `GET /api/public/menus/:slug`, un endpoint público y sin sesión que lee D1 a través de las capas habituales (rutas -> servicios -> repositorios) y devuelve una forma mínima: nombre, slug y logo del local, y categorías con productos (nombre, descripción, precio, foto, disponibilidad). No expone ids, dueño, plan, estado, WhatsApp, fechas ni ingredientes. La respuesta lleva `Cache-Control: public, max-age=60`.

Por qué no KV todavía:

- La copia en KV necesita un paso de publicación, un binding de KV y la experiencia de "Publicar cambios": es una spec aparte.
- El endpoint esconde el origen de los datos detrás de una forma estable. Cuando exista KV, cambian las entrañas de la API, no la app web.
- Leer D1 directo desde el Worker web duplicaría los repositorios y rompería la arquitectura en capas.

Consecuencias: mientras tanto el menú está "en vivo" apenas existe y cada edición del panel se ve al recargar (hasta 60 segundos por la caché). La decisión de [Arquitectura general](Arquitectura-general.md) (el menú público nunca consulta D1) sigue siendo el objetivo; esta lectura es el paso intermedio. Fuera de esta etapa quedan el carrito, el mensaje de WhatsApp, "Publicar cambios" y los colores por plan.

Rutas: `/` es una landing de relleno (prerenderizada) y `/{slug}` el menú. Un slug inexistente, inválido o reservado responde 404 real; si la API falla responde 503 sin caché; un slug en mayúsculas redirige (301) a minúsculas. Se reservaron `precios`, `planes`, `terminos`, `privacidad` y `contacto` para páginas del dominio raíz.

Related: [Arquitectura general](Arquitectura-general.md) · [Modelo de datos](Modelo-de-datos.md) · [Personalización de ingredientes](Personalizacion-de-ingredientes.md)
