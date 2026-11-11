import {
  formatCustomerPhone,
  formatLocalDateTime,
  localDateKey,
  localDayRange,
  normalizeArWhatsapp,
  type CustomerDetail,
  type CustomerImportRequest,
  type CustomerImportResult,
  type CustomerList,
  type CustomerListQuery,
  type CustomerOrdersPage,
  type CustomersHeatmap,
  type CustomerTag,
  type CustomerTagColor,
  type CustomerTagInput,
  type UpdateCustomerInput,
  type UpdateCustomerTagInput,
} from "@menucito/shared";
import { GoogleMapsError, googleMapsClient, type PlacesClient } from "../google-maps";
import { createDeliveryRepository } from "../repositories/delivery";
import { createCustomersRepository, type CustomerFilter, type CustomersRepository } from "../repositories/customers";
import {
  CustomerAddressNotFoundError,
  CustomerNotFoundError,
  CustomerTagNameTakenError,
  CustomerTagNotFoundError,
  PhoneInUseError,
} from "./errors";
import { escapeCsvCell, formatMoneyCsv } from "./orders-csv";

export interface CustomersDependencies {
  customers: CustomersRepository;
  delivery: ReturnType<typeof createDeliveryRepository>;
  places: Pick<PlacesClient, "geocode">;
  now?: () => Date;
  generateId?: () => string;
}

/** Query of the list and the heatmap -> repository filter (local days become UTC bounds). */
export function customerFilterOf(query: CustomerListQuery): CustomerFilter {
  const filter: CustomerFilter = {
    sort: query.sort,
    dir: query.dir,
    ...(query.q ? { q: query.q } : {}),
    ...(query.product ? { productId: query.product } : {}),
    ...(query.tag ? { tagId: query.tag } : {}),
  };
  if (query.from) filter.fromMs = localDayRange(query.from)[0];
  if (query.to) filter.toMs = localDayRange(query.to)[1];
  return filter;
}

function customersToCsv(rows: Awaited<ReturnType<CustomersRepository["listForExport"]>>): string {
  const headers = [
    "Nombre",
    "WhatsApp",
    "Dirección",
    "Pedidos",
    "Gasto total",
    "Ticket promedio",
    "Primer pedido",
    "Último pedido",
    "Etiquetas",
    "Notas",
    "Acepta avisos",
  ];
  const lines = [headers.map(escapeCsvCell).join(";")];
  for (const row of rows) {
    lines.push(
      [
        escapeCsvCell(row.name),
        escapeCsvCell(formatCustomerPhone(row.phone)),
        escapeCsvCell(row.address ?? ""),
        escapeCsvCell(row.orders),
        escapeCsvCell(formatMoneyCsv(row.spentCents)),
        escapeCsvCell(row.averageTicketCents === null ? "" : formatMoneyCsv(row.averageTicketCents)),
        escapeCsvCell(row.firstOrderAt === null ? "" : formatLocalDateTime(row.firstOrderAt)),
        escapeCsvCell(row.lastOrderAt === null ? "" : formatLocalDateTime(row.lastOrderAt)),
        escapeCsvCell(row.tags.map((tag) => tag.name).join(", ")),
        escapeCsvCell(row.notes ?? ""),
        escapeCsvCell(row.whatsappOptInAt === null ? "No" : "Sí"),
      ].join(";"),
    );
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

export function createCustomersService({
  customers,
  delivery,
  places,
  now = () => new Date(),
  generateId = () => crypto.randomUUID(),
}: CustomersDependencies) {
  /** Google failures during an import only mean "keep the text address"; never fail the row. */
  async function geocodeAddress(address: string, restaurantId: string) {
    const location = await delivery.findLocation(restaurantId);
    const bias = location && location.lat !== null && location.lng !== null ? { lat: location.lat, lng: location.lng } : undefined;
    try {
      return await places.geocode({ address, bias });
    } catch (error) {
      if (error instanceof GoogleMapsError) return null;
      throw error;
    }
  }

  async function requireCustomer(restaurantId: string, id: string) {
    const customer = await customers.find(restaurantId, id);
    if (!customer) throw new CustomerNotFoundError();
    return customer;
  }

  async function requireTag(restaurantId: string, id: string): Promise<CustomerTag> {
    const tag = await customers.findTag(restaurantId, id);
    if (!tag) throw new CustomerTagNotFoundError();
    return tag;
  }

  /** Finds or creates the tags of an imported row (`gray` for the new ones), capped to the model size. */
  async function ensureTags(restaurantId: string, names: readonly string[]): Promise<string[]> {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const raw of names) {
      const name = raw.trim().slice(0, 24);
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const existing = await customers.findTagByName(restaurantId, name);
      if (existing) {
        ids.push(existing.id);
        continue;
      }
      try {
        const created = await customers.createTag(generateId(), restaurantId, name, "gray", now());
        ids.push(created.id);
      } catch {
        // A concurrent import created it; its row is the one to use.
        const raced = await customers.findTagByName(restaurantId, name);
        if (!raced) throw new Error(`Could not create the tag ${name}`);
        ids.push(raced.id);
      }
    }
    return ids;
  }

  return {
    async list(restaurantId: string, query: CustomerListQuery): Promise<CustomerList> {
      const { items, total } = await customers.list(restaurantId, customerFilterOf(query), query.page);
      return { items, total, page: query.page };
    },

    async exportCsv(restaurantId: string, query: CustomerListQuery): Promise<{ csv: string; filename: string }> {
      const rows = await customers.listForExport(restaurantId, customerFilterOf(query));
      const date = localDateKey(now().getTime());
      return { csv: customersToCsv(rows), filename: `clientes-${date}.csv` };
    },

    async detail(restaurantId: string, id: string): Promise<CustomerDetail> {
      const detail = await customers.detail(restaurantId, id);
      if (!detail) throw new CustomerNotFoundError();
      return detail;
    },

    async orders(restaurantId: string, id: string, page: number): Promise<CustomerOrdersPage> {
      await requireCustomer(restaurantId, id);
      return customers.orders(restaurantId, id, page);
    },

    async heatmap(restaurantId: string, query: CustomerListQuery): Promise<CustomersHeatmap> {
      return customers.heatmap(restaurantId, customerFilterOf(query));
    },

    async update(restaurantId: string, id: string, input: UpdateCustomerInput): Promise<CustomerDetail> {
      await requireCustomer(restaurantId, id);
      if (input.phone) {
        const owner = await customers.findByPhone(restaurantId, input.phone);
        if (owner && owner.id !== id) throw new PhoneInUseError(owner.name);
      }
      if (input.tagIds) {
        const known = new Set((await customers.listTags(restaurantId)).map((tag) => tag.id));
        for (const tagId of input.tagIds) {
          if (!known.has(tagId)) throw new CustomerTagNotFoundError();
        }
      }

      await customers.update(restaurantId, id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.whatsappOptOut !== undefined ? { whatsappOptOut: input.whatsappOptOut } : {}),
        updatedAt: now(),
      });
      if (input.tagIds) await customers.setCustomerTags(restaurantId, id, input.tagIds);
      return this.detail(restaurantId, id);
    },

    async delete(restaurantId: string, id: string): Promise<void> {
      await requireCustomer(restaurantId, id);
      await customers.delete(restaurantId, id);
    },

    async deleteAddress(restaurantId: string, customerId: string, addressId: string): Promise<void> {
      await requireCustomer(restaurantId, customerId);
      const deleted = await customers.deleteAddress(restaurantId, customerId, addressId);
      if (!deleted) throw new CustomerAddressNotFoundError();
    },

    async import(restaurantId: string, request: CustomerImportRequest): Promise<CustomerImportResult> {
      const result: CustomerImportResult = { created: 0, updated: 0, errors: [] };
      for (const row of request.rows) {
        const name = row.name.trim().slice(0, 60);
        const notes = row.notes.trim().slice(0, 1000) || null;
        const address = row.address.trim().slice(0, 200);

        if (!name) {
          result.errors.push({ row: row.row, message: "Ingresá el nombre del cliente" });
          continue;
        }
        if (!row.phone.trim()) {
          result.errors.push({ row: row.row, message: "Teléfono inválido" });
          continue;
        }
        const phone = normalizeArWhatsapp(row.phone);
        if (!phone) {
          const foreign = row.phone.trim().startsWith("+") && !row.phone.replace(/\s/g, "").startsWith("+54");
          result.errors.push({ row: row.row, message: foreign ? "Número extranjero" : "Teléfono inválido" });
          continue;
        }

        try {
          const existing = await customers.findByPhone(restaurantId, phone);
          const geocoded = address ? await geocodeAddress(address, restaurantId) : null;
          const tagIds = await ensureTags(restaurantId, row.tags);

          if (existing) {
            const hasAddress = await customers.hasAddress(existing.id);
            const fillsAddress = !hasAddress && !existing.address && address.length > 0;
            const fillsNotes = !existing.notes?.trim() && notes !== null;
            if (fillsAddress || fillsNotes) {
              await customers.update(restaurantId, existing.id, {
                ...(fillsNotes ? { notes } : {}),
                // A geocoded address goes to `customer_addresses`; without a result, the text column.
                ...(fillsAddress && !geocoded ? { address } : {}),
                updatedAt: now(),
              });
            }
            if (fillsAddress && geocoded) {
              await customers.insertAddress({
                id: generateId(),
                restaurantId,
                customerId: existing.id,
                formattedAddress: geocoded.formattedAddress || address,
                locality: geocoded.locality,
                lat: geocoded.lat,
                lng: geocoded.lng,
                placeId: geocoded.placeId,
                now: now(),
              });
            }
            await customers.addCustomerTags(restaurantId, existing.id, tagIds);
            result.updated++;
            continue;
          }

          const customerId = generateId();
          await customers.insert({
            id: customerId,
            restaurantId,
            name,
            phone,
            notes,
            // Without a geocoding result the address stays as text; with one it lives in the address row.
            address: address && !geocoded ? address : null,
            now: now(),
          });
          if (address && geocoded) {
            await customers.insertAddress({
              id: generateId(),
              restaurantId,
              customerId,
              formattedAddress: geocoded.formattedAddress || address,
              locality: geocoded.locality,
              lat: geocoded.lat,
              lng: geocoded.lng,
              placeId: geocoded.placeId,
              now: now(),
            });
          }
          if (tagIds.length > 0) await customers.addCustomerTags(restaurantId, customerId, tagIds);
          result.created++;
        } catch (error) {
          console.error("[customers] import row failed", { row: row.row, error: error instanceof Error ? error.message : error });
          result.errors.push({ row: row.row, message: "No pudimos guardar la fila" });
        }
      }
      return result;
    },

    async listTags(restaurantId: string): Promise<CustomerTag[]> {
      return customers.listTags(restaurantId);
    },

    async createTag(restaurantId: string, input: CustomerTagInput): Promise<CustomerTag> {
      const existing = await customers.findTagByName(restaurantId, input.name);
      if (existing) throw new CustomerTagNameTakenError();
      return customers.createTag(generateId(), restaurantId, input.name, input.color, now());
    },

    async updateTag(restaurantId: string, id: string, input: UpdateCustomerTagInput): Promise<CustomerTag> {
      await requireTag(restaurantId, id);
      if (input.name) {
        const existing = await customers.findTagByName(restaurantId, input.name);
        if (existing && existing.id !== id) throw new CustomerTagNameTakenError();
      }
      const updated = await customers.updateTag(restaurantId, id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color as CustomerTagColor } : {}),
      });
      if (!updated) throw new CustomerTagNotFoundError();
      return updated;
    },

    async deleteTag(restaurantId: string, id: string): Promise<void> {
      await requireTag(restaurantId, id);
      await customers.deleteTag(restaurantId, id);
    },
  };
}

export type CustomersService = ReturnType<typeof createCustomersService>;

export function customersServiceFor(env: { DB: D1Database; GOOGLE_MAPS_SERVER_KEY?: string }): CustomersService {
  return createCustomersService({
    customers: createCustomersRepository(env.DB),
    delivery: createDeliveryRepository(env.DB),
    places: googleMapsClient(env),
  });
}
