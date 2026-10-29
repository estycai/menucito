---
title: Planes y precios
date: 2026-10-28
tags: [menucito, negocio, precios, mercadopago]
---

# Planes y precios

Objetivo: **2 USD netos** (plan Básico) y **5 USD netos** (plan Pro), cobrados en pesos con Mercado Pago. Dólar de referencia: **$1.550** (2026-10-28).

## Comisiones de Mercado Pago (suscripciones, Argentina)

| Liberación del dinero | Comisión |
|---|---|
| Al instante | 6,99% + IVA (≈ 8,46%) |
| 10 días | 4,49% + IVA |
| 18 días | 3,39% + IVA |
| 35 días | 1,49% + IVA (≈ 1,80%) |

En suscripciones no hace falta la plata al instante: conviene **liberar a 35 días**. Además, sumar ~3% de margen por retenciones de Ingresos Brutos (varían por provincia).

## Precio final

| Plan | Neto | Precio a 35 días (+ margen IIBB) | Precio al instante |
|---|---|---|---|
| Básico (2 USD) | $3.100 | **$3.300** | $3.400 |
| Pro (5 USD) | $7.750 | **$8.200** | $8.500 |

Fórmula: `precio = neto / (1 - comisión - margen_iibb)`.

## Qué incluye cada plan (propuesta)

**Básico**

- Hasta ~40 productos, 1 foto por producto.
- Pedidos por WhatsApp.
- QR descargable.
- Horarios.
- Logo propio (todos los planes pueden subir el logo de su local).
- Leyenda "Hecho con Menucito".

**Pro**

- Todo ilimitado.
- Sin la marca de Menucito.
- Colores propios (el logo ya está en el Básico).
- Extras y variantes.
- Personalización de ingredientes: sumar o quitar unidades, con costo extra (ver [detalle](../03-arquitectura/Personalizacion-de-ingredientes.md)).
- Estadísticas.
- Carga del menú desde una foto con IA.

El Básico ya incluye pedidos por WhatsApp (muchos competidores no) y el Pro queda muy por debajo del mercado.

## A tener en cuenta

- **Guardar el precio en USD** y recalcular los pesos con un cron (por ejemplo, trimestral) usando la cotización de dolarapi.com o similar; actualizar el monto de las suscripciones activas por API. Probar primero en sandbox.
- **Monotributo:** hace falta inscribirse para facturar. Es un costo fijo mensual: calcular cuántos clientes se necesitan para cubrirlo.

Related: [Competencia en Argentina](../01-mercado/Competencia-Argentina.md) · [Pagos y suscripciones](../03-arquitectura/Pagos-y-suscripciones.md)
