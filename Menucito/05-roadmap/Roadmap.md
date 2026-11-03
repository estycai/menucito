---
title: Roadmap
date: 2026-10-30
tags: [menucito, roadmap]
---

# Roadmap

> **Propuesto, por validar.** Es una propuesta de orden, no una decisión. Vos definís las prioridades; este documento solo ordena el [Backlog](Backlog.md) según qué depende de qué. Las preguntas que faltan resolver están en [Decisiones abiertas](Decisiones-abiertas.md).

## Próximos 3 pasos

1. Realizar la verificación manual en navegador de los escenarios 39 a 64 a 375 px y 1280 px (Fase 1 completada en código y tests).
2. Comenzar la Fase 2: Catálogo completo y tienda (B-25 variantes de producto con `product_variants`, B-26 grupos de adicionales con `option_groups`/`options`).
3. Definir la spec e implementación de horarios del local (B-45 `opening_hours`).

## Lógica del orden

Hoy Menucito muestra el menú y arma el carrito, pero no puede recibir un pedido: no existe la tabla de pedidos. Casi todo lo que sigue (clientes, códigos, reportes, variantes y adicionales en el pedido, horarios y pausa) necesita pedidos guardados, así que la Fase 1 es el cuello de botella. El orden decidido el 2026-11-02 (D-30) es construir las fases 1, 2, 3 y 4 completas y en ese orden, y dejar el cobro de planes (Fase 5) al final. La Fase 5 técnicamente no depende de los pedidos, pero se hace última por decisión. Antes de arrancar la Fase 1 conviene cerrar la Fase 0, que deja el árbol limpio y la apariencia verificada. Las fases son las del plan de implementación; lo que cambió es su contenido, según el [Modelo de datos](../03-arquitectura/Modelo-de-datos.md) y las decisiones del 2026-11-02 (por ejemplo, la tabla de clientes ahora nace en la Fase 1).

Cómo se relaciona con [Próximos pasos](../02-negocio/Proximos-pasos.md): esa nota es la lista de arranque y las decisiones de negocio del 2026-10-28 (casi todo el arranque técnico ya se hizo); esta es el orden de lo que falta construir, y sus decisiones pendientes figuran acá como D-13, D-15, D-17 y D-18.

Tamaño por fase según el plan: Fase 0 chico, Fase 1 grande, fases 2 a 5 medianas.

## Fase 0: Cerrar lo abierto

**Objetivo:** dejar la apariencia verificada, la documentación al día y el árbol de trabajo limpio antes de construir pedidos.

**Ítems, en orden sugerido:** B-111, B-112, B-120, B-119, B-123, B-121, B-113, B-114, B-115, B-116.

**Depende de:** nada. Lo ya construido (cambios 01 a 10) está en la sección Hecho del [Backlog](Backlog.md).

**Criterio de hecho**

- [x] El cambio 10 pasó la corrida manual a 375 px y 1280 px y quedó marcado como hecho.
- [ ] Los archivos sueltos del árbol de trabajo están commiteados, ignorados o movidos.
- [ ] Los estados de `docs/changes/` y las notas del vault reflejan lo que ya está en el código.
- [ ] Las pruebas del editor de producto y los tres arreglos chicos de la revisión (B-114, B-115, B-116) están hechos o descartados a propósito.

**Próxima acción:** B-112, decidir qué hacer con los archivos sueltos (el dueño todavía no decidió). Quedan además B-121 y los cabos chicos B-113 a B-116; ninguno bloquea la Fase 1.

Ya están hechos B-111 (corrida manual del cambio 10), B-119 y B-123. B-120 sigue pendiente: los cambios 04 y 08 necesitan una verificación manual.

## Fase 1: Pedidos de punta a punta

**Objetivo:** convertir el carrito en un pedido guardado, mandarlo por WhatsApp y darle al dueño un panel para seguirlo, con la configuración mínima de la tienda.

**Ítems, en orden sugerido:** B-125, B-126, B-128, B-02, B-05, B-03, B-04, B-127, B-12, B-39, B-40, B-41, B-42, B-43, B-06, B-07, B-08, B-10, B-11, B-09, B-44.

**Depende de:** Fase 0. Sin decisiones previas abiertas: D-01, D-02, D-03, D-06 y D-11 ya están decididas.

**Cambios respecto del plan:** la pausa, el monto mínimo, el costo de envío y los métodos de pago van en `restaurant_settings` y `restaurant_payment_methods` (modelo de datos), no en columnas de `restaurants`. La tabla `customers` se crea en esta fase y cada pedido busca o crea al cliente por teléfono (D-06), en lugar de derivar los clientes de los pedidos. `promo_codes` se crea vacía junto con `orders` (D-11). `orders` guarda `payment_method`, `shipping_cents` y `payment_status` (D-02).

**Criterio de hecho**

- [x] Un cliente envía un pedido desde el carrito y queda guardado con sus ítems, su método de pago y el envío; el total lo calcula el servidor.
- [x] Cada pedido queda asociado a un cliente (buscado o creado por local y teléfono).
- [x] El dueño ve el pedido en el panel y lo mueve hasta Entregado; marca el pago aparte, a mano.
- [x] Un local no puede ver ni modificar pedidos de otro.
- [x] La pausa, el mínimo, el envío y los métodos de pago habilitados se respetan en el carrito y en el servicio.
- [x] El historial se filtra y se exporta a CSV.
- [x] Los locales que ya existían siguen funcionando igual después de las migraciones.

**Próxima acción:** La implementación de la spec 11 está completa en código, schemas, migraciones, endpoints y componentes frontend. La acción siguiente es la corrida manual en navegador (escenarios 39 a 64) a 375 px y 1280 px, y luego iniciar la Fase 2 (catálogo y adicionales).

## Fase 2: Catálogo completo y tienda

**Objetivo:** completar el catálogo con variantes, adicionales con máximo, horarios, QR y redes sociales.

**Ítems, en orden sugerido:** B-25, B-26, B-30, B-27, B-28, B-29, B-31, B-32, B-45, B-46, B-47.

**Depende de:** Fase 1 (los pedidos guardan variante y opciones). Sin decisiones previas abiertas: D-03, D-04, D-05 y D-09 ya están decididas. B-46 y B-47 no dependen de nada y se pueden adelantar.

**Cambios respecto del plan:** ninguno. Con variantes, `products.price_cents` pasa a ser el precio desde (D-04). Ingredientes y opciones se complementan (D-05). Fuera de horario el pedido se rechaza y el botón de WhatsApp del carrito queda gris con la hora de apertura (D-09, en B-45).

**Criterio de hecho**

- [ ] Un producto tiene variantes con precio propio y se elige en el menú público; el precio mostrado sin elegir es el precio desde.
- [ ] Un grupo de adicionales se define una vez, se asigna a varios productos y el carrito respeta el mínimo y el máximo.
- [ ] El pedido guarda la variante y las opciones elegidas con su precio.
- [ ] Fuera de horario el botón de WhatsApp queda deshabilitado y muestra cuándo abre (por ejemplo, Abre hoy a las 19:00), y el servicio rechaza el pedido.
- [ ] El QR se descarga y las redes sociales se ven en el menú público.
- [ ] Los productos existentes siguen funcionando sin variantes.

**Próxima acción:** escribir el cambio 12.

## Fase 3: Clientes y códigos promocionales

**Objetivo:** ver y gestionar a los clientes y permitir códigos promocionales.

**Ítems, en orden sugerido:** B-58, B-59, B-61, B-63, B-60, B-62, B-66, B-67, B-68, B-69, B-70, B-71.

**Depende de:** Fase 2 (por el orden decidido) y de lo construido en la Fase 1: la tabla `customers` y `promo_codes` ya existen. Decisión pendiente: D-19 (si los códigos son del plan gratis), diferida a lanzamiento; se construye sin bloquear por plan.

**Cambios respecto del plan:** la tabla de clientes ya no se crea acá ni se deriva de los pedidos: nace en la Fase 1 (B-125, B-127). Esta fase conserva la lista, el detalle, las notas y el CSV. De `promo_codes` queda la función completa (pantallas, validación y conteo de usos); la tabla vacía ya existe.

**Criterio de hecho**

- [ ] Dos pedidos con el mismo teléfono aparecen como un solo cliente y los cancelados no cuentan en el gasto.
- [ ] El detalle de un cliente muestra sus pedidos y permite guardar notas.
- [ ] El CSV trae las mismas filas que la tabla.
- [ ] Un código válido baja el total y queda en el pedido; uno inactivo o agotado se rechaza con un mensaje claro.
- [ ] El último uso de un código no se puede consumir dos veces a la vez.
- [ ] Un dueño solo ve a los clientes y los códigos de su local.

**Próxima acción:** escribir el cambio 13 con Clientes y Descuentos juntos.

## Fase 4: Reportes básicos

**Objetivo:** reemplazar el placeholder de estadísticas por un reporte sacado de los pedidos.

**Ítems, en orden sugerido:** B-73, B-74, B-75, B-76, B-77.

**Depende de:** Fase 3 (por el orden decidido) y de los pedidos de la Fase 1. El corte de día usa la zona fija de B-128 (D-03). Decisión pendiente: D-19, diferida a lanzamiento.

**Cambio respecto del plan:** ninguno.

**Criterio de hecho**

- [ ] El facturado es la suma de los pedidos no cancelados y coincide con el historial.
- [ ] Un período sin datos para comparar lo dice en lugar de mostrar un porcentaje roto.
- [ ] Un pedido de las 23:30 cuenta en su día local.
- [ ] Un dueño solo ve los números de su local.

**Próxima acción:** escribir el cambio 14.

## Fase 5: Cobro de planes

**Objetivo:** reemplazar el interruptor de prueba por una suscripción real con Mercado Pago.

**Ítems, en orden sugerido:** B-82, B-83, B-84, B-85, B-86, B-87, B-88, B-89, B-90, B-91, B-92, B-93, B-118, B-122.

**Depende de:** Fase 4 por el orden decidido (D-30); técnicamente no depende de los pedidos. Tiene que estar lista antes de cobrar el primer plan. Decisiones: D-10, D-13, D-14 y las diferidas D-16, D-17, D-18 y D-20.

**Cambio respecto del plan:** el plan permitía hacerla en paralelo; ahora va al final (D-30). La suscripción es del usuario y no del restaurante, y no hay tabla `payments`, según el modelo de datos y la decisión del 2026-10-30. El paso del plan "local, plan, estado" pasa a ser "usuario, plan, estado". Quitar `restaurants.plan` y `status` (B-118) es la última migración de la fase.

**Criterio de hecho**

- [ ] Un usuario paga y pasa a Pro sin intervención manual; un webhook repetido no altera la suscripción.
- [ ] Un navegador no puede subir el plan llamando a la API.
- [ ] Un plan vencido vuelve al plan gratis y las funciones Pro se bloquean.
- [ ] La pantalla de plan muestra el estado y la fecha de renovación.
- [ ] `restaurants.plan` y `status` ya no existen.

**Próxima acción:** B-82, confirmar que `ALLOW_PLAN_SWITCH` queda apagado fuera de pruebas (el servidor ya lo exige; falta fijarlo para producción).

## Después

Sin fase asignada; cada ítem tiene un disparador propuesto en el plan.

- **Pedidos:** B-13, B-14, B-15, B-16, B-17, B-18, B-19.
- **Catálogo:** B-33, B-34, B-35.
- **Tienda:** B-48, B-49, B-50, B-51, B-52, B-53, B-54, B-55.
- **Clientes y descuentos:** B-64, B-65, B-72.
- **Reportes e IA:** B-78, B-79, B-80.
- **Planes y plataforma:** B-94, B-99, B-100, B-101, B-102, B-103, B-104, B-124.
- **Deuda técnica:** B-117.

Dos aclaraciones. El despliegue a producción (B-101) y el dominio (B-100) no tienen fase en el plan, pero hacen falta antes de lanzar y antes de cobrar; conviene ubicarlos al final de la Fase 4 o junto con la Fase 5. Y B-18 (cobro al cliente final con Mercado Pago) está en Después por D-01: se quiere, pero desde una vista de Integraciones en el admin (B-124), de la que depende.

**Descartado:** B-56, B-57, B-105, B-106, B-107, B-108, B-109, B-110.

Related: [Backlog](Backlog.md) · [Decisiones abiertas](Decisiones-abiertas.md) · [Próximos pasos](../02-negocio/Proximos-pasos.md) · [Modelo de datos](../03-arquitectura/Modelo-de-datos.md)
