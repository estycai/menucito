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

Decisión de la spec 08: el menú público todavía **no** se lee de KV. La app web (`apps/web`, Astro SSR) pide el menú desde el servidor a `GET /api/public/menus/:slug`, un endpoint público y sin sesión que lee D1 a través de las capas habituales (rutas -> servicios -> repositorios) y devuelve una forma mínima: nombre, slug, logo y modalidades (`delivery`, `takeaway`) del local, y categorías con productos (id, nombre, descripción, precio, foto, disponibilidad e ingredientes). Los únicos ids son los de producto (opacos, son la clave del carrito). No expone dueño, plan, estado, WhatsApp ni fechas, y los ingredientes solo salen si el plan del local los incluye (Pro): en Básico la lista va vacía aunque haya ingredientes guardados de antes de bajar de plan. La respuesta lleva `Cache-Control: public, max-age=60`.

Por qué no KV todavía:

- La copia en KV necesita un paso de publicación, un binding de KV y la experiencia de "Publicar cambios": es una spec aparte.
- El endpoint esconde el origen de los datos detrás de una forma estable. Cuando exista KV, cambian las entrañas de la API, no la app web.
- Leer D1 directo desde el Worker web duplicaría los repositorios y rompería la arquitectura en capas.

Consecuencias: mientras tanto el menú está "en vivo" apenas existe y cada edición del panel se ve al recargar (hasta 60 segundos por la caché). La decisión de [Arquitectura general](Arquitectura-general.md) (el menú público nunca consulta D1) sigue siendo el objetivo; esta lectura es el paso intermedio. Fuera de esta etapa quedan el mensaje de WhatsApp, "Publicar cambios" y los colores por plan.

Rutas: `/` es una landing de relleno (prerenderizada) y `/{slug}` el menú. Un slug inexistente, inválido o reservado responde 404 real; si la API falla responde 503 sin caché; un slug en mayúsculas redirige (301) a minúsculas. Se reservaron `precios`, `planes`, `terminos`, `privacidad` y `contacto` para páginas del dominio raíz.

## Estado actual: carrito y detalle del pedido (spec 09)

El comensal ya puede armar su pedido, pero todavía no se envía.

- **Carrito en el navegador.** Vive en `localStorage`, una clave por local (`menucito:cart:{slug}`), versionada y tolerante a datos faltantes o corruptos. Nada se guarda ni se envía al servidor: los pedidos terminan en WhatsApp, no en nuestra base, y un carrito del lado del servidor pediría sesiones, almacenamiento y limpieza sin beneficio. Es por local y no global porque un comensal puede abrir dos menús y nunca deben mezclarse líneas de locales distintos.
- **Islas Preact.** El HTML del menú lo renderiza el servidor; el botón "Agregar" (que pasa a un selector − N +), la hoja de ingredientes (un `<dialog>` nativo, solo en Pro y solo para productos con ingredientes), la barra "Ver pedido" y el detalle del pedido son islas. Sin JavaScript el menú se lee igual, pero no se puede agregar al pedido.
- **Cálculo en `packages/shared`.** `unitPriceCents`, `lineTotalCents` y `cartTotalCents` aplican las reglas de [Personalización de ingredientes](Personalizacion-de-ingredientes.md) (extra = max(0, cantidad - incluida) x precio extra; quitar no descuenta). Los usan la hoja, la barra y el detalle, y los usará el mensaje de WhatsApp. Dos agregados del mismo producto con las mismas cantidades se funden en una línea (`lineKey`); topes: 20 unidades por línea y 30 líneas.
- **Reconciliación.** Al abrir cualquier página, el carrito guardado se compara con el menú vigente: se descartan productos que ya no existen o están agotados, se usan precios y rangos actuales, y se avisa una sola vez ("Actualizamos tu pedido porque el menú cambió.").
- **Detalle en `/{slug}/pedido`.** Líneas con cambios ("Bacon x2 (+$1.500)", "Sin cebolla"), total y formulario: nombre, retiro o envío (según lo que ofrece el local), dirección (solo en envío) y forma de pago (lista fija: Efectivo, Transferencia, hasta que exista una configuración por local). Los valores del formulario también se recuerdan en el navegador. El botón "Enviar pedido" queda deshabilitado con el aviso de que el envío por WhatsApp llega en el próximo paso: armar el mensaje y abrir `wa.me` es la siguiente spec.

## Estado actual: apariencia y nuevo encabezado (spec 10)

- **Respuesta pública.** `GET /api/public/menus/:slug` suma `restaurant.coverUrl`, `restaurant.description` y `restaurant.colors: { background, primary }`, y `featured: { name, products } | null` aparte de `categories`. La destacada nunca se repite en `categories`; sin productos, `featured` es `null`; si todos están agotados se devuelve igual. Los colores guardados salen solo si el plan incluye `customColors` (Pro); en Básico salen siempre los por defecto aunque haya colores guardados de antes de bajar de plan.
- **Encabezado.** Portada, logo solapado, nombre (`h1`) y descripción. Sin portada, una franja con un tono suave del color principal; sin descripción, no hay párrafo. No hay selector Delivery/Retiro: la modalidad se elige solo en `/{slug}/pedido`, porque el comensal necesita ver el menú antes de decidir cómo recibirlo. La etiqueta "Abierto hasta..." no se muestra todavía: no hay horarios en el modelo y calcularla sería inventarla (llega con la spec de horarios). La descripción también es el `<meta name="description">` ("Menú de <nombre>" si no hay).
- **Destacados.** Una sola categoría destacada por local (se marca en "Mi menú"); sus productos van primero en una fila horizontal con ajuste de posición, y no se repiten como sección ni como chip de la barra.
- **Barra de categorías pegajosa.** Un solo `<nav>` queda pegado arriba; con JavaScript aparece encima una barra de identidad (logo + nombre) y los chips pasan a pestañas subrayadas. El chip de la sección visible se resalta con un script mínimo (`IntersectionObserver` y una función pura probada), no con una isla Preact. Sin JavaScript los chips siguen funcionando como anclas.
- **Tema derivado.** El dueño elige solo dos colores (fondo y principal, Pro). El resto (tinta, superficie, texto secundario, texto sobre el principal, acento, error) lo deriva `themeFromColors` en `packages/shared` con garantía de contraste 4.5:1; el relleno principal nunca se corrige; un principal con menos de 3:1 contra el fondo solo dispara una advertencia en el admin y se guarda igual (la API no lo rechaza). Se aplica como variables CSS en el `<body>` de `/{slug}` y `/{slug}/pedido`. La vista previa del admin usa la misma función, en un mini-render con las variables acotadas al marco del teléfono.

Related: [Arquitectura general](Arquitectura-general.md) · [Modelo de datos](Modelo-de-datos.md) · [Personalización de ingredientes](Personalizacion-de-ingredientes.md)
