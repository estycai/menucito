---
title: Personalización de ingredientes
date: 2026-10-28
tags: [menucito, arquitectura, producto, pro]
aliases: [Ingredientes con cantidad]
---

# Personalización de ingredientes

El comensal puede sumar o quitar unidades de los ingredientes de un producto. Cada ingrediente trae una cantidad incluida en el precio base, y cada unidad por encima de esa cantidad suma un costo extra. Disponible en el plan Pro (ver [Planes y precios](../02-negocio/Planes-y-precios.md)).

## Ejemplo

Hamburguesa completa, precio base $9.000:

| Ingrediente | Incluido | Pedido | Extra |
|---|---|---|---|
| Cebolla | 1 | 1 | $0 |
| Queso | 1 | 1 | $0 |
| Bacon | 1 | 2 | + $1.500 |

El comensal sumó 1 bacon: se cobra una unidad extra al precio de extra del bacon ($1.500).

## Qué configura el restaurante (por ingrediente)

| Campo | Significado | Ejemplo (Bacon) |
|---|---|---|
| `name` | Nombre del ingrediente | Bacon |
| `included_qty` | Unidades que ya trae el producto | 1 |
| `min_qty` | Mínimo que puede pedir (0 = se puede quitar) | 0 |
| `max_qty` | Máximo que puede pedir | 3 |
| `extra_price_cents` | Costo de cada unidad por encima de `included_qty`, en centavos de ARS (entero, como `price_cents`) | $1.500 (`150000`) |

## Reglas de cálculo

```
extra_ingrediente = max(0, qty_pedida - included_qty) * extra_price_cents
precio_unitario   = precio_base + sum(extra_ingrediente) + sum(price_delta de opciones)
total_linea       = precio_unitario * cantidad_del_producto
```

- **Quitar no descuenta** (decisión por defecto): bajar de `included_qty` a menos unidades no resta plata. Si más adelante se quiere, se agrega un campo `discount_per_removed`.
- Validar con Zod (esquema en `packages/shared`, lo usan la API y el formulario del panel): nombre obligatorio (hasta 40 caracteres) y sin repetir dentro del producto (sin distinguir mayúsculas), cantidades enteras de 0 a 99, `max_qty >= 1`, `min_qty <= included_qty <= max_qty` y `extra_price_cents >= 0`. Hasta 20 ingredientes por producto.
- La función de cálculo vive en `packages/shared` y la usan el carrito y el armado del mensaje. El servidor no recalcula porque los pedidos no pasan por él (ver [Menú público y WhatsApp](Menu-publico-y-WhatsApp.md)).

## Cómo se guarda y qué pasa según el plan

- **Se reemplaza la lista completa** (`PUT /api/products/:id/ingredients`), no hay CRUD por ingrediente. El panel guarda el producto de una vez, el orden es parte de la lista y un reemplazo atómico evita estados a medias y carreras al reordenar. El tope de 20 mantiene chico el batch.
- **Solo escribe el plan Pro** (`customIngredients` en `PLAN_LIMITS`). En Básico la API responde 403 `PLAN_FEATURE` y no cambia nada; leer está permitido en todos los planes.
- **Bajar a Básico no borra nada:** el panel muestra los ingredientes guardados en modo solo lectura dentro de la sección bloqueada, y la API rechaza cambios hasta volver a Pro.
- **Borrar el producto borra sus ingredientes** (`on delete cascade`).
- En Básico, "Ingredientes" y "Extras y variantes" se ven bloqueados (en gris, con la marca PRO y el enlace "Ver plan Pro"). "Extras y variantes" es un aviso "Próximamente" en todos los planes.

## Diferencia con opciones y extras

- **Ingredientes:** parte del producto, con cantidad incluida y cantidad editable (ej: bacon x2).
- **Opciones y extras** (`option_groups`): elecciones que no tienen cantidad base (ej: "Punto de la carne", "Papas").

## Cómo aparece en el mensaje de WhatsApp

Solo se listan los ingredientes que difieren de lo incluido:

```
2x Hamburguesa completa ($25.000)
   - Punto: a punto
   - Bacon x2 (+$1.500)
   - Sin cebolla
```

## Dónde se ve

- Panel: sección "Ingredientes" en la pantalla de edición del producto (editable en Pro, solo de un producto ya guardado). Ya implementado.
- Menú público (todavía no existe; la función de cálculo y el mensaje de WhatsApp llegan con él): filas con selector de cantidad en el detalle del producto, con el extra resaltado cuando se supera lo incluido.
- Bocetos: Claude Design, pantallas "Detalle de producto" y "Editar producto".

Related: [Modelo de datos](Modelo-de-datos.md) · [Menú público y WhatsApp](Menu-publico-y-WhatsApp.md) · [Planes y precios](../02-negocio/Planes-y-precios.md)
