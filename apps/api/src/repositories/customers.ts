import type {
  CustomerAddressItem,
  CustomerDetail,
  CustomerHeatmapPoint,
  CustomerListItem,
  CustomerOrderRow,
  CustomerOrdersPage,
  CustomersHeatmap,
  CustomerSortDir,
  CustomerSortField,
  CustomerTag,
  CustomerTagColor,
} from "@menucito/shared";
import { CUSTOMER_HISTORY_PAGE_SIZE, CUSTOMER_PAGE_SIZE, customerPhoneSearchDigits } from "@menucito/shared";

/**
 * Customers section (change 17a). The list, the sheet and the heatmap are computed live from
 * `orders` with correlated aggregates; nothing is stored twice.
 */

export interface CustomerFilter {
  q?: string;
  /** Inclusive. */
  fromMs?: number;
  /** Exclusive. */
  toMs?: number;
  productId?: string;
  tagId?: string;
  sort: CustomerSortField;
  dir: CustomerSortDir;
}

export interface CustomerBaseRow {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  address: string | null;
  whatsappOptInAt: number | null;
  whatsappOptInSource: string | null;
  whatsappOptOut: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CustomerExportRow extends CustomerListItem {
  notes: string | null;
  averageTicketCents: number | null;
  firstOrderAt: number | null;
  whatsappOptInAt: number | null;
}

export interface NewCustomerData {
  id: string;
  restaurantId: string;
  name: string;
  phone: string;
  notes: string | null;
  /** Text address, used only when geocoding did not find the place. */
  address: string | null;
  now: Date;
}

export interface NewCustomerAddressData {
  id: string;
  restaurantId: string;
  customerId: string;
  formattedAddress: string;
  locality: string | null;
  lat: number;
  lng: number;
  placeId: string | null;
  now: Date;
}

export interface CustomersRepository {
  list(restaurantId: string, filter: CustomerFilter, page: number): Promise<{ items: CustomerListItem[]; total: number }>;
  listForExport(restaurantId: string, filter: CustomerFilter): Promise<CustomerExportRow[]>;
  find(restaurantId: string, id: string): Promise<CustomerBaseRow | null>;
  findByPhone(restaurantId: string, phone: string): Promise<CustomerBaseRow | null>;
  insert(data: NewCustomerData): Promise<void>;
  update(
    restaurantId: string,
    id: string,
    fields: {
      name?: string;
      phone?: string;
      notes?: string | null;
      address?: string | null;
      whatsappOptOut?: boolean;
      updatedAt: Date;
    },
  ): Promise<void>;
  /** Anonymizes the orders and deletes the customer, its addresses and links. */
  delete(restaurantId: string, id: string): Promise<void>;
  detail(restaurantId: string, id: string): Promise<CustomerDetail | null>;
  orders(restaurantId: string, customerId: string, page: number): Promise<CustomerOrdersPage>;
  addresses(customerId: string): Promise<CustomerAddressItem[]>;
  hasAddress(customerId: string): Promise<boolean>;
  insertAddress(data: NewCustomerAddressData): Promise<void>;
  /** `false` when the address does not belong to the customer (or the local). */
  deleteAddress(restaurantId: string, customerId: string, addressId: string): Promise<boolean>;
  heatmap(restaurantId: string, filter: CustomerFilter): Promise<CustomersHeatmap>;
  listTags(restaurantId: string): Promise<CustomerTag[]>;
  findTag(restaurantId: string, id: string): Promise<CustomerTag | null>;
  findTagByName(restaurantId: string, name: string): Promise<CustomerTag | null>;
  createTag(id: string, restaurantId: string, name: string, color: CustomerTagColor, now: Date): Promise<CustomerTag>;
  updateTag(restaurantId: string, id: string, fields: { name?: string; color?: CustomerTagColor }): Promise<CustomerTag | null>;
  deleteTag(restaurantId: string, id: string): Promise<boolean>;
  setCustomerTags(restaurantId: string, customerId: string, tagIds: readonly string[]): Promise<void>;
  addCustomerTags(restaurantId: string, customerId: string, tagIds: readonly string[]): Promise<void>;
  tagIdsOf(customerId: string): Promise<string[]>;
}

const number = (value: unknown): number => Number(value ?? 0);
const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

/** A tag color read from the database, falling back to `gray` if it is not in the palette. */
const tagColor = (value: unknown): CustomerTagColor =>
  (["orange", "blue", "green", "purple", "pink", "teal", "amber", "gray"] as const).includes(
    value as CustomerTagColor,
  )
    ? (value as CustomerTagColor)
    : "gray";

/** Keeps the tags of many customers to a couple of queries, under D1's bound-parameter limit. */
const TAG_QUERY_CHUNK = 90;

export function createCustomersRepository(d1: D1Database): CustomersRepository {
  async function all<T>(sql: string, params: (string | number)[]): Promise<T[]> {
    return (await d1.prepare(sql).bind(...params).all<T>()).results;
  }

  async function first<T>(sql: string, params: (string | number)[]): Promise<T | null> {
    return d1.prepare(sql).bind(...params).first<T>();
  }

  /** The WHERE shared by the list, the export and the heatmap: it picks customers, not their numbers. */
  function buildWhere(restaurantId: string, filter: CustomerFilter) {
    const clauses = ["c.restaurant_id = ?"];
    const params: (string | number)[] = [restaurantId];

    if (filter.q) {
      const digits = customerPhoneSearchDigits(filter.q);
      if (digits) {
        clauses.push("(lower(c.name) LIKE ? OR c.phone LIKE ?)");
        params.push(`%${filter.q.toLowerCase()}%`, `%${digits}%`);
      } else {
        clauses.push("lower(c.name) LIKE ?");
        params.push(`%${filter.q.toLowerCase()}%`);
      }
    }

    if (filter.fromMs !== undefined || filter.toMs !== undefined) {
      const date = ["o.status <> 'cancelled'"];
      if (filter.fromMs !== undefined) {
        date.push("o.created_at >= ?");
        params.push(filter.fromMs);
      }
      if (filter.toMs !== undefined) {
        date.push("o.created_at < ?");
        params.push(filter.toMs);
      }
      clauses.push(
        `EXISTS (SELECT 1 FROM orders o WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id AND ${date.join(" AND ")})`,
      );
    }

    if (filter.productId) {
      const date = ["o.status <> 'cancelled'", "i.product_id = ?"];
      params.push(filter.productId);
      if (filter.fromMs !== undefined) {
        date.push("o.created_at >= ?");
        params.push(filter.fromMs);
      }
      if (filter.toMs !== undefined) {
        date.push("o.created_at < ?");
        params.push(filter.toMs);
      }
      clauses.push(
        `EXISTS (SELECT 1 FROM orders o JOIN order_items i ON i.order_id = o.id
                  WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id AND ${date.join(" AND ")})`,
      );
    }

    if (filter.tagId) {
      clauses.push(
        "EXISTS (SELECT 1 FROM customer_tag_links l WHERE l.customer_id = c.id AND l.restaurant_id = c.restaurant_id AND l.tag_id = ?)",
      );
      params.push(filter.tagId);
    }

    return { sql: clauses.join(" AND "), params };
  }

  async function tagsFor(customerIds: readonly string[]): Promise<Map<string, CustomerTag[]>> {
    const byCustomer = new Map<string, CustomerTag[]>();
    for (let start = 0; start < customerIds.length; start += TAG_QUERY_CHUNK) {
      const chunk = customerIds.slice(start, start + TAG_QUERY_CHUNK);
      if (chunk.length === 0) continue;
      const rows = await all<{ customerId: string; id: string; name: string; color: string }>(
        `SELECT l.customer_id AS customerId, t.id AS id, t.name AS name, t.color AS color
           FROM customer_tag_links l
           JOIN customer_tags t ON t.id = l.tag_id
          WHERE l.customer_id IN (${chunk.map(() => "?").join(", ")})
          ORDER BY lower(t.name), t.id`,
        chunk,
      );
      for (const row of rows) {
        const list = byCustomer.get(row.customerId) ?? [];
        list.push({ id: row.id, name: row.name, color: tagColor(row.color) });
        byCustomer.set(row.customerId, list);
      }
    }
    return byCustomer;
  }

  function toListItem(
    row: {
      id: string;
      name: string;
      phone: string;
      address: string | null;
      addressLat: number | null;
      addressLng: number | null;
      orders: number;
      spentCents: number;
      lastOrderAt: number | null;
    },
    tags: CustomerTag[],
  ): CustomerListItem {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      address: row.address,
      addressLat: nullableNumber(row.addressLat),
      addressLng: nullableNumber(row.addressLng),
      orders: number(row.orders),
      spentCents: number(row.spentCents),
      lastOrderAt: nullableNumber(row.lastOrderAt),
      tags,
    };
  }

  const listSelect = `SELECT c.id AS id, c.name AS name, c.phone AS phone, c.address AS textAddress,
      (SELECT a.formatted_address FROM customer_addresses a
        WHERE a.customer_id = c.id ORDER BY a.last_used_at DESC, a.created_at DESC LIMIT 1) AS savedAddress,
      (SELECT a.lat FROM customer_addresses a
        WHERE a.customer_id = c.id ORDER BY a.last_used_at DESC, a.created_at DESC LIMIT 1) AS addressLat,
      (SELECT a.lng FROM customer_addresses a
        WHERE a.customer_id = c.id ORDER BY a.last_used_at DESC, a.created_at DESC LIMIT 1) AS addressLng,
      (SELECT COUNT(*) FROM orders o
        WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id AND o.status <> 'cancelled') AS orders,
      (SELECT COALESCE(SUM(o.total_cents), 0) FROM orders o
        WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id
          AND o.status = 'delivered' AND o.payment_status = 'paid') AS spentCents,
      (SELECT MAX(o.created_at) FROM orders o
        WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id AND o.status <> 'cancelled') AS lastOrderAt,
      (SELECT MIN(o.created_at) FROM orders o
        WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id AND o.status <> 'cancelled') AS firstOrderAt
    FROM customers c`;

  return {
    async list(restaurantId, filter, page) {
      const where = buildWhere(restaurantId, filter);
      const sortColumn = {
        orders: "orders",
        spent: "spentCents",
        last: "lastOrderAt",
        name: "lower(c.name)",
        since: "firstOrderAt",
      }[filter.sort];
      const dir = filter.dir === "asc" ? "ASC" : "DESC";
      const offset = (page - 1) * CUSTOMER_PAGE_SIZE;

      const rows = await all<{
        id: string;
        name: string;
        phone: string;
        textAddress: string | null;
        savedAddress: string | null;
        addressLat: number | null;
        addressLng: number | null;
        orders: number;
        spentCents: number;
        lastOrderAt: number | null;
      }>(
        `${listSelect}
          WHERE ${where.sql}
          ORDER BY ${sortColumn} ${dir}, lower(c.name) ASC, c.id
          LIMIT ? OFFSET ?`,
        [...where.params, CUSTOMER_PAGE_SIZE, offset],
      );

      const total = await first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM customers c WHERE ${where.sql}`,
        where.params,
      );
      const tags = await tagsFor(rows.map((row) => row.id));
      return {
        items: rows.map((row) =>
          toListItem(
            {
              ...row,
              address: row.savedAddress ?? row.textAddress,
              addressLat: row.savedAddress ? row.addressLat : null,
              addressLng: row.savedAddress ? row.addressLng : null,
            },
            tags.get(row.id) ?? [],
          ),
        ),
        total: number(total?.count),
      };
    },

    async listForExport(restaurantId, filter) {
      const where = buildWhere(restaurantId, filter);
      const sortColumn = {
        orders: "orders",
        spent: "spentCents",
        last: "lastOrderAt",
        name: "lower(c.name)",
        since: "firstOrderAt",
      }[filter.sort];
      const dir = filter.dir === "asc" ? "ASC" : "DESC";
      const rows = await all<{
        id: string;
        name: string;
        phone: string;
        textAddress: string | null;
        savedAddress: string | null;
        addressLat: number | null;
        addressLng: number | null;
        orders: number;
        spentCents: number;
        lastOrderAt: number | null;
        firstOrderAt: number | null;
        notes: string | null;
        whatsappOptInAt: number | null;
        salesCount: number;
        productsCents: number;
      }>(
        `SELECT c.id, c.name, c.phone, c.notes, c.whatsapp_opt_in_at AS whatsappOptInAt, c.address AS textAddress,
                (SELECT a.formatted_address FROM customer_addresses a
                  WHERE a.customer_id = c.id ORDER BY a.last_used_at DESC, a.created_at DESC LIMIT 1) AS savedAddress,
                (SELECT a.lat FROM customer_addresses a
                  WHERE a.customer_id = c.id ORDER BY a.last_used_at DESC, a.created_at DESC LIMIT 1) AS addressLat,
                (SELECT a.lng FROM customer_addresses a
                  WHERE a.customer_id = c.id ORDER BY a.last_used_at DESC, a.created_at DESC LIMIT 1) AS addressLng,
                (SELECT COUNT(*) FROM orders o
                  WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id AND o.status <> 'cancelled') AS orders,
                (SELECT COALESCE(SUM(o.total_cents), 0) FROM orders o
                  WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id
                    AND o.status = 'delivered' AND o.payment_status = 'paid') AS spentCents,
                (SELECT COUNT(*) FROM orders o
                  WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id
                    AND o.status = 'delivered' AND o.payment_status = 'paid') AS salesCount,
                (SELECT COALESCE(SUM(o.subtotal_cents - o.discount_cents), 0) FROM orders o
                  WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id
                    AND o.status = 'delivered' AND o.payment_status = 'paid') AS productsCents,
                (SELECT MAX(o.created_at) FROM orders o
                  WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id AND o.status <> 'cancelled') AS lastOrderAt,
                (SELECT MIN(o.created_at) FROM orders o
                  WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id AND o.status <> 'cancelled') AS firstOrderAt
           FROM customers c
          WHERE ${where.sql}
          ORDER BY ${sortColumn} ${dir}, lower(c.name) ASC, c.id`,
        where.params,
      );

      const tags = await tagsFor(rows.map((row) => row.id));
      return rows.map((row) => ({
        ...toListItem(
          {
            ...row,
            address: row.savedAddress ?? row.textAddress,
            addressLat: row.savedAddress ? row.addressLat : null,
            addressLng: row.savedAddress ? row.addressLng : null,
          },
          tags.get(row.id) ?? [],
        ),
        notes: row.notes,
        firstOrderAt: nullableNumber(row.firstOrderAt),
        whatsappOptInAt: nullableNumber(row.whatsappOptInAt),
        averageTicketCents:
          number(row.salesCount) > 0 ? Math.round(number(row.productsCents) / number(row.salesCount)) : null,
      }));
    },

    async find(restaurantId, id) {
      const row = await first<{
        id: string;
        name: string;
        phone: string;
        notes: string | null;
        address: string | null;
        whatsappOptInAt: number | null;
        whatsappOptInSource: string | null;
        whatsappOptOut: number;
        createdAt: number;
        updatedAt: number;
      }>(
        `SELECT id, name, phone, notes, address, whatsapp_opt_in_at AS whatsappOptInAt,
                whatsapp_opt_in_source AS whatsappOptInSource, whatsapp_opt_out AS whatsappOptOut,
                created_at AS createdAt, updated_at AS updatedAt
           FROM customers WHERE restaurant_id = ? AND id = ?`,
        [restaurantId, id],
      );
      return row
        ? {
            ...row,
            whatsappOptInAt: nullableNumber(row.whatsappOptInAt),
            whatsappOptOut: Boolean(row.whatsappOptOut),
            createdAt: number(row.createdAt),
            updatedAt: number(row.updatedAt),
          }
        : null;
    },

    async findByPhone(restaurantId, phone) {
      const row = await first<{
        id: string;
        name: string;
        phone: string;
        notes: string | null;
        address: string | null;
        whatsappOptInAt: number | null;
        whatsappOptInSource: string | null;
        whatsappOptOut: number;
        createdAt: number;
        updatedAt: number;
      }>(
        `SELECT id, name, phone, notes, address, whatsapp_opt_in_at AS whatsappOptInAt,
                whatsapp_opt_in_source AS whatsappOptInSource, whatsapp_opt_out AS whatsappOptOut,
                created_at AS createdAt, updated_at AS updatedAt
           FROM customers WHERE restaurant_id = ? AND phone = ?`,
        [restaurantId, phone],
      );
      return row
        ? {
            ...row,
            whatsappOptInAt: nullableNumber(row.whatsappOptInAt),
            whatsappOptOut: Boolean(row.whatsappOptOut),
            createdAt: number(row.createdAt),
            updatedAt: number(row.updatedAt),
          }
        : null;
    },

    async insert(data) {
      await d1
        .prepare(
          `INSERT INTO customers (id, restaurant_id, name, phone, address, notes, first_order_at,
                                  whatsapp_opt_in_at, whatsapp_opt_in_source, whatsapp_opt_out,
                                  created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?, ?)`,
        )
        .bind(
          data.id,
          data.restaurantId,
          data.name,
          data.phone,
          data.address,
          data.notes,
          data.now.getTime(),
          data.now.getTime(),
        )
        .run();
    },

    async update(restaurantId, id, fields) {
      const sets: string[] = ["updated_at = ?"];
      const params: (string | number | null)[] = [fields.updatedAt.getTime()];
      if (fields.name !== undefined) {
        sets.push("name = ?");
        params.push(fields.name);
      }
      if (fields.phone !== undefined) {
        sets.push("phone = ?");
        params.push(fields.phone);
      }
      if (fields.notes !== undefined) {
        sets.push("notes = ?");
        params.push(fields.notes);
      }
      if (fields.address !== undefined) {
        sets.push("address = ?");
        params.push(fields.address);
      }
      if (fields.whatsappOptOut !== undefined) {
        sets.push("whatsapp_opt_out = ?");
        params.push(fields.whatsappOptOut ? 1 : 0);
      }
      params.push(restaurantId, id);
      await d1
        .prepare(`UPDATE customers SET ${sets.join(", ")} WHERE restaurant_id = ? AND id = ?`)
        .bind(...params)
        .run();
    },

    async delete(restaurantId, id) {
      await d1.batch([
        d1
          .prepare(
            `UPDATE orders
                SET customer_id = NULL, customer_name = 'Cliente eliminado', customer_phone = '',
                    delivery_address = NULL, delivery_lat = NULL, delivery_lng = NULL,
                    delivery_place_id = NULL, delivery_unit = NULL, delivery_between_streets = NULL,
                    delivery_label = NULL, notes = NULL
              WHERE restaurant_id = ? AND customer_id = ?`,
          )
          .bind(restaurantId, id),
        d1.prepare("DELETE FROM customers WHERE restaurant_id = ? AND id = ?").bind(restaurantId, id),
      ]);
    },

    async detail(restaurantId, id) {
      const base = await first<CustomerBaseRow & { salesCount: number; productsCents: number; firstOrderAt: number | null; lastOrderAt: number | null; orders: number; spentCents: number }>(
        `SELECT c.id, c.name, c.phone, c.notes, c.address,
                c.whatsapp_opt_in_at AS whatsappOptInAt, c.whatsapp_opt_in_source AS whatsappOptInSource,
                c.whatsapp_opt_out AS whatsappOptOut, c.created_at AS createdAt, c.updated_at AS updatedAt,
                (SELECT COUNT(*) FROM orders o
                  WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id AND o.status <> 'cancelled') AS orders,
                (SELECT COALESCE(SUM(o.total_cents), 0) FROM orders o
                  WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id
                    AND o.status = 'delivered' AND o.payment_status = 'paid') AS spentCents,
                (SELECT COUNT(*) FROM orders o
                  WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id
                    AND o.status = 'delivered' AND o.payment_status = 'paid') AS salesCount,
                (SELECT COALESCE(SUM(o.subtotal_cents - o.discount_cents), 0) FROM orders o
                  WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id
                    AND o.status = 'delivered' AND o.payment_status = 'paid') AS productsCents,
                (SELECT MIN(o.created_at) FROM orders o
                  WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id AND o.status <> 'cancelled') AS firstOrderAt,
                (SELECT MAX(o.created_at) FROM orders o
                  WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id AND o.status <> 'cancelled') AS lastOrderAt
           FROM customers c
          WHERE c.restaurant_id = ? AND c.id = ?`,
        [restaurantId, id],
      );
      if (!base) return null;
      const [addresses, tags] = await Promise.all([this.addresses(id), tagsFor([id])]);
      return {
        id: base.id,
        name: base.name,
        phone: base.phone,
        notes: base.notes,
        whatsappOptInAt: nullableNumber(base.whatsappOptInAt),
        whatsappOptInSource:
          base.whatsappOptInSource === "web" || base.whatsappOptInSource === "manual"
            ? base.whatsappOptInSource
            : null,
        whatsappOptOut: Boolean(base.whatsappOptOut),
        tags: tags.get(id) ?? [],
        addresses,
        orders: number(base.orders),
        spentCents: number(base.spentCents),
        averageTicketCents:
          number(base.salesCount) > 0 ? Math.round(number(base.productsCents) / number(base.salesCount)) : null,
        firstOrderAt: nullableNumber(base.firstOrderAt),
        lastOrderAt: nullableNumber(base.lastOrderAt),
      };
    },

    async orders(restaurantId, customerId, page) {
      const offset = (page - 1) * CUSTOMER_HISTORY_PAGE_SIZE;
      const rows = await all<{
        id: string;
        number: number;
        fulfillment: "delivery" | "takeaway";
        createdAt: number;
        paymentMethod: CustomerOrderRow["paymentMethod"];
        paymentStatus: CustomerOrderRow["paymentStatus"];
        status: CustomerOrderRow["status"];
        totalCents: number;
      }>(
        `SELECT id, number, fulfillment, created_at AS createdAt, payment_method AS paymentMethod,
                payment_status AS paymentStatus, status, total_cents AS totalCents
           FROM orders
          WHERE restaurant_id = ? AND customer_id = ? AND status <> 'cancelled'
          ORDER BY created_at DESC, number DESC
          LIMIT ? OFFSET ?`,
        [restaurantId, customerId, CUSTOMER_HISTORY_PAGE_SIZE, offset],
      );
      const total = await first<{ count: number }>(
        "SELECT COUNT(*) AS count FROM orders WHERE restaurant_id = ? AND customer_id = ? AND status <> 'cancelled'",
        [restaurantId, customerId],
      );

      const itemsByOrder = new Map<string, { name: string; quantity: number }[]>();
      if (rows.length > 0) {
        const items = await all<{ orderId: string; name: string; quantity: number }>(
          `SELECT order_id AS orderId, name, quantity FROM order_items
            WHERE order_id IN (${rows.map(() => "?").join(", ")})
            ORDER BY order_id, position`,
          rows.map((row) => row.id),
        );
        for (const item of items) {
          const list = itemsByOrder.get(item.orderId) ?? [];
          list.push({ name: item.name, quantity: number(item.quantity) });
          itemsByOrder.set(item.orderId, list);
        }
      }

      return {
        items: rows.map((row) => {
          const items = itemsByOrder.get(row.id) ?? [];
          return {
            ...row,
            createdAt: number(row.createdAt),
            totalCents: number(row.totalCents),
            itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
            items: items.slice(0, 3),
          };
        }),
        total: number(total?.count),
        page,
        pageSize: CUSTOMER_HISTORY_PAGE_SIZE,
      };
    },

    async addresses(customerId) {
      const rows = await all<{
        id: string;
        label: string | null;
        formattedAddress: string;
        lat: number;
        lng: number;
        lastUsedAt: number;
      }>(
        `SELECT id, label, formatted_address AS formattedAddress, lat, lng, last_used_at AS lastUsedAt
           FROM customer_addresses
          WHERE customer_id = ?
          ORDER BY last_used_at DESC, created_at DESC`,
        [customerId],
      );
      return rows.map((row) => ({ ...row, lastUsedAt: number(row.lastUsedAt) }));
    },

    async hasAddress(customerId) {
      const found = await first<{ one: number }>("SELECT 1 AS one FROM customer_addresses WHERE customer_id = ? LIMIT 1", [
        customerId,
      ]);
      return Boolean(found);
    },

    async insertAddress(data) {
      await d1
        .prepare(
          `INSERT INTO customer_addresses
             (id, restaurant_id, customer_id, label, formatted_address, locality, lat, lng, place_id,
              between_streets, unit, created_at, last_used_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
        )
        .bind(
          data.id,
          data.restaurantId,
          data.customerId,
          data.formattedAddress,
          data.locality,
          data.lat,
          data.lng,
          data.placeId,
          data.now.getTime(),
          data.now.getTime(),
        )
        .run();
    },

    async deleteAddress(restaurantId, customerId, addressId) {
      const result = await d1
        .prepare("DELETE FROM customer_addresses WHERE id = ? AND customer_id = ? AND restaurant_id = ?")
        .bind(addressId, customerId, restaurantId)
        .run();
      return (result.meta.changes ?? 0) > 0;
    },

    async heatmap(restaurantId, filter) {
      const where = buildWhere(restaurantId, filter);
      const rows = await all<{ lat: number | null; lng: number | null; weight: number }>(
        `SELECT a.lat AS lat, a.lng AS lng,
                (SELECT COUNT(*) FROM orders o
                  WHERE o.restaurant_id = c.restaurant_id AND o.customer_id = c.id
                    AND o.status <> 'cancelled') AS weight
           FROM customers c
           LEFT JOIN customer_addresses a ON a.id = (
             SELECT x.id FROM customer_addresses x
              WHERE x.customer_id = c.id ORDER BY x.last_used_at DESC, x.created_at DESC LIMIT 1
           )
          WHERE ${where.sql}
          ORDER BY weight DESC, c.id
          LIMIT 5000`,
        where.params,
      );
      const counts = await first<{ total: number; withoutAddress: number }>(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM customer_addresses a WHERE a.customer_id = c.id)
                                  THEN 0 ELSE 1 END), 0) AS withoutAddress
           FROM customers c
          WHERE ${where.sql}`,
        where.params,
      );
      const store = await first<{ lat: number; lng: number }>(
        "SELECT lat, lng FROM restaurant_settings WHERE restaurant_id = ? AND lat IS NOT NULL AND lng IS NOT NULL",
        [restaurantId],
      );
      const points: CustomerHeatmapPoint[] = [];
      for (const row of rows) {
        if (row.lat === null || row.lng === null) continue;
        points.push({ lat: Number(row.lat), lng: Number(row.lng), weight: number(row.weight) });
      }
      return {
        points,
        withoutAddress: number(counts?.withoutAddress),
        total: number(counts?.total),
        store: store ? { lat: Number(store.lat), lng: Number(store.lng) } : null,
      };
    },

    async listTags(restaurantId) {
      const rows = await all<{ id: string; name: string; color: string }>(
        "SELECT id, name, color FROM customer_tags WHERE restaurant_id = ? ORDER BY lower(name), id",
        [restaurantId],
      );
      return rows.map((row) => ({ id: row.id, name: row.name, color: tagColor(row.color) }));
    },

    async findTag(restaurantId, id) {
      const row = await first<{ id: string; name: string; color: string }>(
        "SELECT id, name, color FROM customer_tags WHERE restaurant_id = ? AND id = ?",
        [restaurantId, id],
      );
      return row ? { id: row.id, name: row.name, color: tagColor(row.color) } : null;
    },

    async findTagByName(restaurantId, name) {
      const row = await first<{ id: string; name: string; color: string }>(
        "SELECT id, name, color FROM customer_tags WHERE restaurant_id = ? AND lower(name) = lower(?)",
        [restaurantId, name],
      );
      return row ? { id: row.id, name: row.name, color: tagColor(row.color) } : null;
    },

    async createTag(id, restaurantId, name, color, now) {
      await d1
        .prepare("INSERT INTO customer_tags (id, restaurant_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id, restaurantId, name, color, now.getTime())
        .run();
      return { id, name, color };
    },

    async updateTag(restaurantId, id, fields) {
      const sets: string[] = [];
      const params: (string | number)[] = [];
      if (fields.name !== undefined) {
        sets.push("name = ?");
        params.push(fields.name);
      }
      if (fields.color !== undefined) {
        sets.push("color = ?");
        params.push(fields.color);
      }
      if (sets.length > 0) {
        await d1
          .prepare(`UPDATE customer_tags SET ${sets.join(", ")} WHERE restaurant_id = ? AND id = ?`)
          .bind(...params, restaurantId, id)
          .run();
      }
      return this.findTag(restaurantId, id);
    },

    async deleteTag(restaurantId, id) {
      const result = await d1
        .prepare("DELETE FROM customer_tags WHERE restaurant_id = ? AND id = ?")
        .bind(restaurantId, id)
        .run();
      return (result.meta.changes ?? 0) > 0;
    },

    async setCustomerTags(restaurantId, customerId, tagIds) {
      const statements = [
        d1.prepare("DELETE FROM customer_tag_links WHERE customer_id = ? AND restaurant_id = ?").bind(customerId, restaurantId),
        ...tagIds.map((tagId) =>
          d1
            .prepare(
              `INSERT OR IGNORE INTO customer_tag_links (customer_id, tag_id, restaurant_id)
               SELECT ?, id, restaurant_id FROM customer_tags WHERE id = ? AND restaurant_id = ?`,
            )
            .bind(customerId, tagId, restaurantId),
        ),
      ];
      await d1.batch(statements);
    },

    async addCustomerTags(restaurantId, customerId, tagIds) {
      if (tagIds.length === 0) return;
      await d1.batch(
        tagIds.map((tagId) =>
          d1
            .prepare(
              `INSERT OR IGNORE INTO customer_tag_links (customer_id, tag_id, restaurant_id)
               SELECT ?, id, restaurant_id FROM customer_tags WHERE id = ? AND restaurant_id = ?`,
            )
            .bind(customerId, tagId, restaurantId),
        ),
      );
    },

    async tagIdsOf(customerId) {
      const rows = await all<{ tagId: string }>(
        "SELECT tag_id AS tagId FROM customer_tag_links WHERE customer_id = ?",
        [customerId],
      );
      return rows.map((row) => row.tagId);
    },
  };
}
