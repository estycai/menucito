---
title: Decisiones abiertas
date: 2026-10-30
tags: [menucito, roadmap]
---

# Decisiones abiertas

Cada decisión que frena o condiciona trabajo del [Backlog](Backlog.md). Las que dicen "Diferida a lanzamiento" se dejaron a propósito para más adelante: no hace falta decidirlas ahora. Las decididas el 2026-11-02 pasaron a la sección Decididas con su ID original. El orden en que conviene resolverlas está en el [Roadmap](Roadmap.md).

## Abiertas

| ID | Pregunta | Por qué importa | Opciones y trade-offs | Recomendación | Bloquea | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| D-07 | Al bajar de plan con varios locales, ¿los locales extra quedan en solo lectura? | Solo importa cuando un plan permita más de un local; el código hoy limita a uno. | Solo lectura: no se pierde nada. · Se desactiva el menú público: más duro, ahorra recursos. | Solo lectura; resolverlo cuando exista el segundo plan. | B-94 | Abierta |
| D-08 | ¿delivery y takeaway pasan a restaurant_settings? | Hoy viven en restaurants y se decidió no tocarlos por ahora; queda definir si migrarlos después. | Dejarlos: cero riesgo. · Moverlos: modelo más prolijo, migración de datos existentes. | Dejarlos hasta que haya un motivo funcional. | B-49 | Abierta |
| D-10 | Al vencer el plan pago, ¿qué pasa con los productos que superan el límite del plan gratis? | Define la regla de degradación. Hoy solo se limita la creación y los productos existentes se conservan. | Ocultar el excedente en el menú público: castiga al cliente final. · Bloquear la edición pero mostrar todo: más amable. | Bloquear la edición y mostrar todo, como ya hace el servicio. | B-88 | Abierta |
| D-13 | ¿Cada cuánto se actualiza el precio en pesos (mensual o trimestral)? | Define el cron y cuánta inflación absorbe Menucito. | Mensual: protege el margen, más cambios para el cliente. · Trimestral: más estable, el margen se erosiona. | Mensual al principio; relajarlo si la inflación baja. | B-91 | Abierta |
| D-14 | ¿Qué comprobante recibe el cliente por la suscripción y cuándo se inscribe el monotributo? | Sin eso no se puede cobrar legalmente; el plan no lo analizó. | Comprobante manual al principio. · Facturación automática con un proveedor: costo y trabajo. | Consultar con un contador antes de lanzar y empezar manual. | B-93 | Abierta |
| D-15 | ¿Cuál es el nombre definitivo y el dominio .com.ar? | Desbloquea el despliegue, el dominio del webhook y el dominio de emails. | Quedarse con Menucito si el dominio está libre. · Cambiar el nombre antes de publicar. | Verificar la disponibilidad en NIC Argentina y cerrar el nombre antes del despliegue. | B-100 | Abierta |
| D-16 | ¿Cuándo se empieza a cobrar? | Marca el límite para tener lista la Fase 5. | Fecha de lanzamiento. · Después de un período de pruebas con los primeros clientes. | Decidirlo al lanzar, como se acordó. | B-85 | Diferida a lanzamiento |
| D-17 | ¿Cuánto dura la prueba del plan pago? | Define trial_ends_at y la degradación al vencer. | Sin prueba: el plan gratis ya cumple ese rol. · Prueba corta del plan pago. | Decidirlo al lanzar, como se acordó. | - | Diferida a lanzamiento |
| D-18 | ¿Cuáles son los límites del plan gratis? | Hoy son placeholders en plans.ts (40 productos, fotos incluidas). | Mantener 40 productos. · Subir o bajar el tope. | Decidirlo al lanzar, como se acordó. | B-92 | Diferida a lanzamiento |
| D-19 | ¿Qué queda solo en el plan pago? | Hoy figuran variantes y extras, estadísticas, colores propios, retiro de marca e importación con IA; el plan no dice si los códigos son del plan gratis. | Todo lo avanzado en Pro. · Variantes y códigos en gratis, que es lo que pide una hamburguesería. | Decidirlo al lanzar; mientras tanto construir sin bloquear por plan. | B-31, B-48, B-66, B-74 | Diferida a lanzamiento |
| D-20 | ¿Qué dominio usa Resend para los emails? | Sin dominio verificado los emails de login solo funcionan en pruebas. | Dominio propio al comprarlo. · Subdominio de pruebas hasta entonces. | Decidirlo cuando se compre el dominio, como se acordó. | B-89, B-99 | Diferida a lanzamiento |

## Decididas

| ID | Decisión | Fecha |
| --- | --- | --- |
| D-01 | El cobro con Mercado Pago al cliente final se quiere, pero más adelante y desde una nueva vista de Integraciones en el admin. No entra en el MVP. | 2026-11-02 |
| D-02 | orders guarda payment_method y shipping_cents como foto del pedido. payment_status se mantiene como eje separado de status; mientras no haya pago online, el dueño lo marca a mano como pagado. Las columnas ya están en el modelo de datos y en el editor. | 2026-11-02 |
| D-03 | Zona horaria fija America/Argentina/Buenos_Aires, con la constante en un solo lugar. | 2026-11-02 |
| D-04 | Opción A. Con variantes, products.price_cents deja de cargarse a mano y pasa a ser el precio desde (el de la variante disponible más barata). Los productos sin variantes siguen usando price_cents como hoy. | 2026-11-02 |
| D-05 | Ingredientes y opciones se complementan. Los ingredientes conservan la cantidad mínima, máxima e incluida por ingrediente (min_qty y max_qty ya cubren que una hamburguesa no se pueda vender con 0 medallones); los grupos de opciones usan min_select y max_select para elecciones discretas. El dueño lo aceptó razonando desde ese ejemplo, sin nombrar una opción. | 2026-11-02 |
| D-06 | Se crea una fila de cliente con el primer pedido (buscar o crear por restaurant_id y teléfono). La tabla customers existe desde la Fase 1 y orders.customer_id apunta a ella. Reemplaza el plan anterior de derivar los clientes de los pedidos; la Fase 3 conserva las pantallas de lista, detalle, notas y CSV. | 2026-11-02 |
| D-09 | Fuera de horario el pedido se rechaza; no se programa. En el carrito, el botón Mandar por WhatsApp queda deshabilitado (gris) y muestra cuándo abre, por ejemplo Abre hoy a las 19:00. Los pedidos programados quedan en Después. | 2026-11-02 |
| D-11 | promo_codes se crea vacía junto con orders en la Fase 1, así orders.promo_code_id tiene su clave foránea desde el principio. La función de códigos (pantallas, validación y conteo de usos) queda en la Fase 3. | 2026-11-02 |
| D-12 | Los avisos de estado por WhatsApp y los menús por modalidad pasan a Después. | 2026-11-02 |
| D-21 | Dos planes: Basic (gratis) y Pro (pago, con todo incluido). | 2026-10-30 |
| D-22 | PedidosYa y Rappi quedan como trabajo futuro. | 2026-10-30 |
| D-23 | Un usuario puede tener N restaurantes en la base; el código permite 1 por ahora. Un plan más alto subirá el límite. | 2026-10-30 |
| D-24 | La suscripción pertenece al usuario, no al restaurante. | 2026-10-30 |
| D-25 | restaurants guarda solo identidad. Apariencia, configuración, métodos de pago, redes y horarios viven en tablas propias (restaurant_appearance, restaurant_settings, restaurant_payment_methods, restaurant_social_links, opening_hours) que cuelgan de restaurants. | 2026-10-30 |
| D-26 | El alias de transferencia y el titular son columnas tipadas de restaurant_payment_methods. | 2026-10-30 |
| D-27 | delivery y takeaway se quedan en restaurants por ahora. | 2026-10-30 |
| D-28 | restaurants.plan y status se quitan a favor de la suscripción, en una migración aparte que depende del trabajo de suscripciones. | 2026-10-30 |
| D-29 | Hecho hoy: restaurant_appearance implementada y commiteada (06f377f a ee4dce8), el editor guarda ingredientes junto con el producto, hay confirmaciones de guardado y el color de bajo contraste es solo una advertencia. | 2026-10-30 |
| D-30 | Orden de construcción: las fases 1, 2, 3 y 4 se hacen completas y en ese orden; el cobro de planes (Fase 5) va al final. Técnicamente la Fase 5 no depende de los pedidos. | 2026-11-02 |

Related: [Backlog](Backlog.md) · [Roadmap](Roadmap.md) · [Modelo de datos](../03-arquitectura/Modelo-de-datos.md) · [Planes y precios](../02-negocio/Planes-y-precios.md) · [Pagos y suscripciones](../03-arquitectura/Pagos-y-suscripciones.md)
