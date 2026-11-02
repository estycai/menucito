---
title: Backlog
date: 2026-10-30
tags: [menucito, roadmap]
---

# Backlog

Lista maestra de todo lo que está hecho o por hacer en Menucito. Para el orden propuesto mirá el [Roadmap](Roadmap.md); para lo que falta decidir, las [Decisiones abiertas](Decisiones-abiertas.md).

Cómo leerla:

- **Fase**: 0 a 5 sigue el plan de implementación. `Después` es trabajo diferido y `Descartado` es lo que Menucito no necesita. La Fase 0 incluye lo ya construido.
- **Tamaño**: solo cuando los documentos dan una estimación (el análisis de competencia estima por función: Bajo, Medio y Alto, que acá son S, M y L; los ítems de documentación y deuda marcados S son obvios). El plan estima por fase, no por ítem; el resto queda `sin estimar`.
- **Depende de**: ítems que deben existir antes. **Bloqueado por**: decisión abierta que frena el ítem.

## Pedidos

| ID | Item | Fase | Tamaño | Estado | Depende de | Bloqueado por |
| --- | --- | --- | --- | --- | --- | --- |
| B-01 | Carrito y detalle de pedido (cambio 09) | 0 | sin estimar | Hecho | - | - |
| B-02 | Tablas orders y order_items con migración (incluye shipping_cents, payment_method y payment_status) | 1 | sin estimar | Pendiente | B-111, B-125, B-126 | - |
| B-03 | Servicio de pedidos (totales en servidor, número correlativo) | 1 | sin estimar | Pendiente | B-02 | - |
| B-04 | Rutas de pedidos (crear público; listar, ver y cambiar estado en admin) | 1 | sin estimar | Pendiente | B-03 | - |
| B-05 | Teléfono normalizado en el formulario del carrito | 1 | sin estimar | Pendiente | B-01 | - |
| B-06 | Envío del pedido por WhatsApp con el mensaje armado | 1 | sin estimar | Pendiente | B-04, B-05 | - |
| B-07 | Estado del pedido y estado de pago como ejes independientes (el dueño marca el pago a mano) | 1 | S | Pendiente | B-02 | - |
| B-08 | Panel del dueño con tres columnas (Nuevo, En preparación, Listo) | 1 | M | Pendiente | B-04 | - |
| B-09 | Alta manual de pedidos en el panel | 1 | sin estimar | Pendiente | B-08 | - |
| B-10 | Historial de pedidos con filtros | 1 | M | Pendiente | B-04 | - |
| B-11 | Exportación del historial a CSV | 1 | sin estimar | Pendiente | B-10 | - |
| B-12 | Pruebas del servicio y rutas de pedidos (totales, aislamiento entre locales) | 1 | sin estimar | Pendiente | B-04 | - |
| B-13 | Panel de pedidos en tiempo real | Después | sin estimar | Pendiente | B-08 | - |
| B-14 | Aviso sonoro de pedido nuevo en el panel | Después | sin estimar | Pendiente | B-08 | - |
| B-15 | Pedidos programados fuera de horario (en el MVP se rechaza: ver B-45) | Después | sin estimar | Pendiente | B-45 | - |
| B-16 | Avisos de estado por WhatsApp al cliente | Después | M | Pendiente | B-06 | - |
| B-17 | Monitor de pedidos para el cliente | Después | S | Pendiente | B-08 | - |
| B-18 | Link de pago o QR de Mercado Pago para el cliente final | Después | M | Pendiente | B-02, B-124 | - |
| B-19 | Transferencia con alias único por pedido | Después | M | Pendiente | B-18 | - |

## Catálogo

| ID | Item | Fase | Tamaño | Estado | Depende de | Bloqueado por |
| --- | --- | --- | --- | --- | --- | --- |
| B-20 | Categorías y productos con fotos (cambio 04) | 0 | sin estimar | Hecho | - | - |
| B-21 | Interruptor disponible o agotado | 0 | S | Hecho | - | - |
| B-22 | Personalización por ingredientes, solo Pro (cambio 07) | 0 | sin estimar | Hecho | - | - |
| B-23 | Categoría destacada (cambio 10) | 0 | sin estimar | Hecho | - | - |
| B-24 | Guardado de ingredientes junto con el producto y confirmaciones de guardado | 0 | sin estimar | Hecho | - | - |
| B-25 | Variantes de producto (tabla product_variants); con variantes, products.price_cents pasa a ser el precio desde, derivado de la variante disponible más barata | 2 | M | Pendiente | B-02 | - |
| B-26 | Grupos de adicionales (option_groups, options, product_option_groups) con min_select y max_select | 2 | M | Pendiente | B-02 | - |
| B-27 | Editor de producto con variantes y asignación de grupos | 2 | sin estimar | Pendiente | B-25, B-26 | - |
| B-28 | Biblioteca de adicionales en el admin | 2 | sin estimar | Pendiente | B-26 | - |
| B-29 | Selector de variante y adicionales en el menú público y el carrito | 2 | sin estimar | Pendiente | B-25, B-26 | - |
| B-30 | Variante y opciones elegidas guardadas en el ítem del pedido | 2 | sin estimar | Pendiente | B-02, B-25, B-26 | - |
| B-31 | Marcar variantes y adicionales como Pro en plans.ts | 2 | sin estimar | Pendiente | B-25, B-26 | D-19 |
| B-32 | Pruebas de precios con variantes y límites de selección | 2 | sin estimar | Pendiente | B-30 | - |
| B-33 | Menú separado por modalidad (delivery y retiro) | Después | M | Pendiente | B-20 | - |
| B-34 | Importar y exportar el menú | Después | M | Pendiente | B-20 | - |
| B-35 | Carga de la carta desde una foto con IA | Después | sin estimar | Pendiente | B-34 | - |

## Tienda

| ID | Item | Fase | Tamaño | Estado | Depende de | Bloqueado por |
| --- | --- | --- | --- | --- | --- | --- |
| B-36 | Landing placeholder y menú público (cambio 08) | 0 | sin estimar | Hecho | - | - |
| B-37 | Apariencia del local y menú público: portada, colores, descripción (cambio 10) | 0 | sin estimar | Hecho | - | - |
| B-38 | Interruptores de delivery y retiro (columnas en restaurants) | 0 | sin estimar | Hecho | - | - |
| B-39 | Tabla restaurant_settings con migración y valores por defecto neutros | 1 | sin estimar | Pendiente | B-111 | - |
| B-40 | Pausa de la tienda con cartel para el cliente | 1 | sin estimar | Pendiente | B-39, B-03 | - |
| B-41 | Monto mínimo de compra | 1 | sin estimar | Pendiente | B-39, B-03 | - |
| B-42 | Costo de envío fijo, solo en delivery | 1 | sin estimar | Pendiente | B-39, B-03 | - |
| B-43 | Métodos de pago por local con alias de transferencia (restaurant_payment_methods) | 1 | sin estimar | Pendiente | B-39 | - |
| B-44 | Pantalla de configuración en LocalPage (Recepción de pedidos, Pagos y envío) | 1 | sin estimar | Pendiente | B-40, B-41, B-42, B-43 | - |
| B-45 | Horarios del local (opening_hours): fuera de horario el pedido se rechaza; el botón Mandar por WhatsApp del carrito queda gris y muestra cuándo abre (por ejemplo, Abre hoy a las 19:00) | 2 | sin estimar | Pendiente | B-03, B-128 | - |
| B-46 | QR descargable (reemplaza el placeholder de /qr) | 2 | sin estimar | Pendiente | - | - |
| B-47 | Redes sociales en el menú público (restaurant_social_links) | 2 | sin estimar | Pendiente | - | - |
| B-48 | Leyenda Hecho con Menucito y su retiro en Pro | Después | sin estimar | Pendiente | B-36 | D-19 |
| B-49 | Mover delivery y takeaway a restaurant_settings | Después | sin estimar | Pendiente | B-39 | D-08 |
| B-50 | Zonas de entrega y costo de envío por zona o con mapa | Después | sin estimar | Pendiente | B-42 | - |
| B-51 | Disponible en por modalidad y horario de pedidos programados | Después | sin estimar | Pendiente | B-45 | - |
| B-52 | Pixel, GA4 y Tag Manager | Después | sin estimar | Pendiente | B-36 | - |
| B-53 | Conversions API y Measurement Protocol | Después | sin estimar | Pendiente | B-52 | - |
| B-54 | Propinas, reseñas, aviso por email y otras mejoras de experiencia del cliente | Después | sin estimar | Pendiente | B-04 | - |
| B-55 | Asistente de IA por WhatsApp | Después | sin estimar | Pendiente | B-06 | - |
| B-56 | Modalidad Salón | Descartado | sin estimar | Descartado | - | - |
| B-57 | Caja y stock, cierre del día, pantalla cliente, kiosco e impresión | Descartado | sin estimar | Descartado | - | - |

## Clientes

| ID | Item | Fase | Tamaño | Estado | Depende de | Bloqueado por |
| --- | --- | --- | --- | --- | --- | --- |
| B-58 | Listado de clientes con cantidad de pedidos, gasto total y último pedido (sobre la tabla customers) | 3 | S | Pendiente | B-04, B-127 | - |
| B-125 | Tabla customers con migración (orders.customer_id apunta a ella) | 1 | sin estimar | Pendiente | B-111 | - |
| B-127 | Buscar o crear el cliente por restaurante y teléfono al crear el pedido | 1 | sin estimar | Pendiente | B-03, B-125, B-05 | - |
| B-59 | Búsqueda, orden y paginado de clientes | 3 | sin estimar | Pendiente | B-58 | - |
| B-60 | Exportación de clientes a CSV | 3 | sin estimar | Pendiente | B-58 | - |
| B-61 | Página Clientes en el admin con enlace directo a WhatsApp | 3 | sin estimar | Pendiente | B-58 | - |
| B-62 | Revisión de obligaciones por datos personales antes de lanzar | 3 | sin estimar | Pendiente | B-58 | - |
| B-63 | Detalle de cliente y notas del dueño | 3 | sin estimar | Pendiente | B-58 | - |
| B-64 | Etiquetas, cumpleaños y mapa de calor de clientes | Después | M | Pendiente | B-63 | - |
| B-65 | Sistema de puntos | Después | M | Pendiente | B-58 | - |

## Descuentos

| ID | Item | Fase | Tamaño | Estado | Depende de | Bloqueado por |
| --- | --- | --- | --- | --- | --- | --- |
| B-126 | Tabla promo_codes vacía, creada junto con orders | 1 | sin estimar | Pendiente | B-111 | - |
| B-66 | Ajustes de promo_codes y descuento aplicado en orders (la tabla llega vacía en la Fase 1) | 3 | sin estimar | Pendiente | B-126, B-02 | D-19 |
| B-67 | Servicio de códigos con uso atómico y descuento calculado en servidor | 3 | sin estimar | Pendiente | B-66, B-03 | - |
| B-68 | Rutas de códigos (validar desde el carrito; crear, editar y desactivar en admin) | 3 | sin estimar | Pendiente | B-67 | - |
| B-69 | Campo de código promocional en el carrito | 3 | sin estimar | Pendiente | B-68 | - |
| B-70 | Pantalla de códigos en el admin con interruptor Activo | 3 | sin estimar | Pendiente | B-68 | - |
| B-71 | Pruebas de códigos (porcentaje, monto fijo, agotado, inactivo, otro local) | 3 | sin estimar | Pendiente | B-67 | - |
| B-72 | Descuentos por modalidad, por producto y 2x1 | Después | M | Pendiente | B-67 | - |

## Reportes

| ID | Item | Fase | Tamaño | Estado | Depende de | Bloqueado por |
| --- | --- | --- | --- | --- | --- | --- |
| B-73 | Repositorio de agregaciones sobre orders y order_items | 4 | sin estimar | Pendiente | B-02, B-128 | - |
| B-74 | Servicio y rutas de reportes con control de plan | 4 | sin estimar | Pendiente | B-73 | D-19 |
| B-75 | Reportes básicos en el admin: filtros, KPIs, gráfico y tablas (reemplaza /estadisticas) | 4 | M | Pendiente | B-74 | - |
| B-76 | Exportación de las tablas de reportes a CSV | 4 | sin estimar | Pendiente | B-75 | - |
| B-77 | Pruebas con datos sembrados y comparación contra el historial | 4 | sin estimar | Pendiente | B-74, B-10 | - |
| B-78 | Ganancia neta y food cost | Después | L | Pendiente | B-75 | - |
| B-79 | Clientes recurrentes, mapa de calor de horarios y análisis con IA | Después | sin estimar | Pendiente | B-75 | - |
| B-80 | Asistente de IA en el admin | Después | L | Pendiente | B-75 | - |

## Planes y cobros

| ID | Item | Fase | Tamaño | Estado | Depende de | Bloqueado por |
| --- | --- | --- | --- | --- | --- | --- |
| B-81 | Interruptor de plan de prueba (cambio 06) | 0 | sin estimar | Hecho | - | - |
| B-82 | Verificar que ALLOW_PLAN_SWITCH quede apagado en producción | 5 | S | Pendiente | - | - |
| B-83 | Tabla subscriptions por usuario con migración | 5 | sin estimar | Pendiente | B-111 | - |
| B-84 | Credenciales de Mercado Pago como secretos del Worker, en modo de prueba | 5 | sin estimar | Pendiente | - | - |
| B-85 | Rutas de suscripción: iniciar y webhook con verificación de firma | 5 | sin estimar | Pendiente | B-83, B-84 | D-16 |
| B-86 | Cambiar el plan solo desde el webhook y cerrar PUT /restaurants/me/plan | 5 | sin estimar | Pendiente | B-85 | - |
| B-87 | PlanPage con el estado real de la suscripción y la renovación | 5 | sin estimar | Pendiente | B-85 | - |
| B-88 | Degradación al plan gratis al vencer | 5 | sin estimar | Pendiente | B-86 | D-10 |
| B-89 | Período de gracia de 5 días y aviso por email ante un pago fallido | 5 | sin estimar | Pendiente | B-85 | D-20 |
| B-90 | Pruebas de webhooks repetidos y fuera de orden | 5 | sin estimar | Pendiente | B-85 | - |
| B-91 | Actualización periódica del monto en pesos desde el precio en USD | 5 | sin estimar | Pendiente | B-85 | D-13 |
| B-92 | Límites finales del plan gratis en plans.ts (hoy son placeholders) | 5 | sin estimar | Pendiente | - | D-18 |
| B-93 | Comprobante de la suscripción y alta de monotributo | 5 | sin estimar | Pendiente | - | D-14 |
| B-94 | Límite de restaurantes por plan (max_restaurants) en el servicio | Después | sin estimar | Pendiente | B-83 | D-07 |

## Plataforma

| ID | Item | Fase | Tamaño | Estado | Depende de | Bloqueado por |
| --- | --- | --- | --- | --- | --- | --- |
| B-95 | Login con Better Auth: email, Google y recuperación (cambio 01) | 0 | sin estimar | Hecho | - | - |
| B-96 | Alta del restaurante (cambio 02) | 0 | sin estimar | Hecho | - | - |
| B-97 | Logo y storage en R2 (cambio 03) | 0 | sin estimar | Hecho | - | - |
| B-98 | Shell del admin con navegación persistente (cambio 05) | 0 | sin estimar | Hecho | - | - |
| B-99 | Dominio de Resend para los emails de login | Después | sin estimar | Pendiente | B-100 | D-20 |
| B-100 | Nombre definitivo y dominio .com.ar | Después | sin estimar | Pendiente | - | D-15 |
| B-101 | Despliegue a producción (Workers, dominios, CI/CD) | Después | sin estimar | Pendiente | B-100 | - |
| B-124 | Vista de Integraciones en el admin | Después | sin estimar | Pendiente | B-98 | - |
| B-128 | Constante de zona horaria America/Argentina/Buenos_Aires en un solo lugar | 1 | S | Pendiente | B-111 | - |
| B-102 | Publicación del menú en KV y flujo Publicar cambios | Después | sin estimar | Pendiente | B-36 | - |
| B-103 | PedidosYa, Rappi y Mercado Pago Delivery | Después | L | Pendiente | B-04 | - |
| B-104 | Logística externa (Rapiboy, Cabify) y facturación ARCA | Después | L | Pendiente | B-04 | - |
| B-105 | Cajas y arqueos | Descartado | sin estimar | Descartado | - | - |
| B-106 | Stock con recetas, merma y costeo | Descartado | sin estimar | Descartado | - | - |
| B-107 | Repartidores propios y su rendición | Descartado | sin estimar | Descartado | - | - |
| B-108 | Pantalla de cocina (KDS) | Descartado | sin estimar | Descartado | - | - |
| B-109 | Usuarios con roles y permisos | Descartado | sin estimar | Descartado | - | - |
| B-110 | Gastos y proveedores | Descartado | sin estimar | Descartado | - | - |

## Deuda técnica

| ID | Item | Fase | Tamaño | Estado | Depende de | Bloqueado por |
| --- | --- | --- | --- | --- | --- | --- |
| B-111 | Corrida manual del cambio 10 en el navegador (tarea 8, escenarios 15 a 33) | 0 | sin estimar | Hecho | - | - |
| B-112 | Decidir qué hacer con archivos sin commitear ajenos (.design-canvas, .claude/launch.json, PDF de análisis) | 0 | S | Pendiente | - | - |
| B-113 | Pruebas del guardado del editor de producto (el admin no tiene pruebas de componentes) | 0 | sin estimar | Pendiente | - | - |
| B-114 | Carrera en categories.setFeatured: si se borra el destino entre la verificación y el batch, queda sin destacada | 0 | sin estimar | Pendiente | - | - |
| B-115 | Dos subidas simultáneas de portada o logo pueden dejar un objeto huérfano en R2 | 0 | sin estimar | Pendiente | - | - |
| B-116 | El join interno del repositorio de restaurantes devuelve 404 sin log si falta la fila de apariencia | 0 | sin estimar | Pendiente | - | - |
| B-117 | Dos altas simultáneas de producto pueden superar el límite del plan por uno | Después | sin estimar | Pendiente | - | - |
| B-118 | Quitar restaurants.plan y status a favor de la suscripción (migración aparte) | 5 | sin estimar | Pendiente | B-83, B-86 | - |

## Docs

| ID | Item | Fase | Tamaño | Estado | Depende de | Bloqueado por |
| --- | --- | --- | --- | --- | --- | --- |
| B-119 | Corregir docs/changes/02 y 03: dicen que logo_url está en restaurants | 0 | S | Hecho | - | - |
| B-120 | Actualizar el estado de los cambios 02, 03, 04, 08 y 10 (siguen aprobados o en borrador) | 0 | S | Pendiente | B-111 | - |
| B-121 | Alinear Planes-y-precios con los dos planes (Basic gratis, Pro pago) | 0 | S | Pendiente | - | - |
| B-122 | Alinear Pagos-y-suscripciones con la suscripción por usuario y sin tabla payments | 5 | S | Pendiente | B-83 | - |
| B-123 | Actualizar Modelo-de-datos: la migración 0005 ya está commiteada | 0 | S | Hecho | - | - |

## Hecho

Lo construido hasta hoy (cambios 01 a 10). Los ítems con estado Hecho de las tablas de arriba salen de esta lista.

| Cambio | Qué entregó | Commit | Documento |
| --- | --- | --- | --- |
| 01 Auth | Login con email, Google y recuperación de contraseña; vista de bienvenida | Commit inicial b6480d5. Falta el dominio de Resend. | `docs/changes/01-auth-login.md` |
| 02 Alta del restaurante | Onboarding con nombre, slug, WhatsApp y modalidades | Commit inicial b6480d5 | `docs/changes/02-restaurant-onboarding.md` |
| 03 Logo y storage | Subida del logo a R2 | 56c882d | `docs/changes/03-logo-storage.md` |
| 04 Catálogo | Categorías, productos, fotos y estado disponible o agotado | 7bf7786 | `docs/changes/04-menu-catalog.md` |
| 05 Shell del admin | Navegación persistente del panel | ab4ec7b | `docs/changes/05-admin-shell.md` |
| 06 Interruptor de plan | Cambio de plan de prueba, sin cobro real | 093380f | `docs/changes/06-plan-switch.md` |
| 07 Ingredientes Pro | Configurador de ingredientes y secciones bloqueadas Pro | b7cefe9 (spec en 165e154) | `docs/changes/07-pro-features-ingredients.md` |
| 08 Landing y menú público | Web en Astro con landing placeholder y menú público | a8bc9e4 | `docs/changes/08-web-landing-public-menu.md` |
| 09 Carrito y detalle de pedido | Carrito y formulario del pedido, sin envío todavía | 53c1390 | `docs/changes/09-cart-order-detail.md` |
| 10 Apariencia del local y menú público | Tabla restaurant_appearance, portada, colores, categoría destacada y guardado de ingredientes con confirmaciones | 06f377f, 369b2ff, 7669581, eeb430e, ee4dce8 | `docs/changes/10-apariencia-del-local-y-menu-publico.md` |

Los estados dentro de `docs/changes/` ya reflejan esto, salvo el 04 y el 08: les falta una verificación manual en el navegador (B-120 sigue pendiente). El cambio 11 (pedidos) está escrito en `docs/changes/11-pedidos-de-punta-a-punta.md` y cubre la Fase 1 del Roadmap salvo B-09.

Related: [Roadmap](Roadmap.md) · [Decisiones abiertas](Decisiones-abiertas.md) · [Modelo de datos](../03-arquitectura/Modelo-de-datos.md) · [Próximos pasos](../02-negocio/Proximos-pasos.md)
