import { useEffect, useState, type ReactNode } from "react";
import type { UseFormReturn } from "react-hook-form";
import {
  CASH_TENDERED_MAX_CENTS,
  MAX_LINE_QUANTITY,
  PAYMENT_LABELS,
  PAYMENT_SPLIT_MESSAGES,
  TIP_PERCENTAGES,
  addToCart,
  canHaveTip,
  cartTotalCents,
  describeChanges,
  formatArs,
  orderTotals,
  removeLine,
  setLineQuantity,
  splitCashProblem,
  tipFromPercent,
  lineTotalCents,
  type CartLine,
  type OrderDelivery,
  type PublicMenu,
  type PublicMenuProduct,
  type Quantities,
} from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ManualProductDialog } from "@/components/orders/new-order/ManualProductDialog";
import { useManualDeliveryQuote } from "@/lib/new-order-api";
import { pesosToCents, type NewOrderFormValues } from "@/lib/new-order";
import { cn } from "@/lib/utils";

interface NewOrderCartStepProps {
  form: UseFormReturn<NewOrderFormValues>;
  menu: PublicMenu;
  lines: CartLine[];
  onLinesChange: (lines: CartLine[]) => void;
  delivery: OrderDelivery | null;
  onBack: () => void;
  onCancel: () => void;
  onCreate: (input: {
    totalCents: number;
    tipCents: number;
    splitCashCents: number | null;
    cashTenderedCents: number | null;
  }) => void;
  creating: boolean;
  error: string | null;
}

type ProductDialogState =
  | { mode: "add"; product: PublicMenuProduct }
  | { mode: "edit"; product: PublicMenuProduct; line: CartLine }
  | null;

/** Step 2 of "Nuevo pedido": catalog on the left, cart and payment on the right. */
export function NewOrderCartStep({
  form,
  menu,
  lines,
  onLinesChange,
  delivery,
  onBack,
  onCancel,
  onCreate,
  creating,
  error,
}: NewOrderCartStepProps) {
  const { register, setValue, watch } = form;  const fulfillment = watch("fulfillment");
  const paymentMethod = watch("paymentMethod");
  const splitCash = watch("splitCash");
  const cashTendered = watch("cashTendered");
  const tipCents = watch("tipCents");

  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [productDialog, setProductDialog] = useState<ProductDialogState>(null);
  const [cartError, setCartError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  const groups = [
    ...(menu.featured ? [{ name: menu.featured.name, products: menu.featured.products }] : []),
    ...menu.categories,
  ];
  const products = new Map(groups.flatMap((group) => group.products).map((product) => [product.id, product]));
  const subtotalCents = cartTotalCents(lines, products);

  const zones = menu.restaurant.deliveryMode === "zones";
  const quoteEnabled = fulfillment === "delivery" && zones && delivery !== null;
  const quote = useManualDeliveryQuote(
    quoteEnabled && delivery ? { lat: delivery.lat, lng: delivery.lng, subtotalCents } : null,
  );
  const covered = !zones || quote.data?.covered === true;
  const shippingCents =
    fulfillment === "takeaway"
      ? 0
      : zones
        ? quote.data?.covered
          ? quote.data.shippingCents
          : 0
        : menu.restaurant.shippingCents;
  const minOrderCents =
    fulfillment === "delivery" && zones && quote.data?.covered
      ? (quote.data.minOrderCents ?? menu.restaurant.minOrderCents)
      : menu.restaurant.minOrderCents;
  const belowMinimum = minOrderCents !== null && subtotalCents < minOrderCents;
  const totals = orderTotals({
    subtotalCents,
    shippingCents,
    tipCents,
    fulfillment,
  });

  const offeredPayments = menu.restaurant.paymentMethods.map((method) => method.method);
  const tipVisible = canHaveTip(fulfillment, paymentMethod);

  useEffect(() => {
    if (offeredPayments.length > 0 && !offeredPayments.includes(paymentMethod)) {
      setValue("paymentMethod", offeredPayments[0]!);
    }
  }, [offeredPayments, paymentMethod, setValue]);

  useEffect(() => {
    if (!tipVisible && tipCents > 0) setValue("tipCents", 0);
  }, [tipVisible, tipCents, setValue]);

  const splitCents = pesosToCents(splitCash);
  const tenderedCents = pesosToCents(cashTendered);

  let paymentError: string | null = null;
  if (paymentMethod === "split") {
    if (!splitCash.trim()) paymentError = PAYMENT_SPLIT_MESSAGES.splitRequired;
    else if (typeof splitCents !== "number") paymentError = PAYMENT_SPLIT_MESSAGES.splitInvalid;
    else {
      const problem = splitCashProblem(splitCents, totals.totalCents, totals.tipCents);
      if (problem) paymentError = PAYMENT_SPLIT_MESSAGES[problem];
    }
  }
  if (!paymentError && tenderedCents !== null && tenderedCents !== undefined) {
    const cashPart = paymentMethod === "cash" ? totals.totalCents : (splitCents ?? 0);
    if (tenderedCents > CASH_TENDERED_MAX_CENTS) paymentError = PAYMENT_SPLIT_MESSAGES.tenderedTooHigh;
    else if (tenderedCents < cashPart) paymentError = PAYMENT_SPLIT_MESSAGES.tenderedTooLow;
  }
  if (!paymentError && tenderedCents === null) paymentError = PAYMENT_SPLIT_MESSAGES.tenderedInvalid;

  const quoteFailed = quoteEnabled && quote.isError;
  const quotePending = quoteEnabled && quote.isLoading;
  const canCreate =
    lines.length > 0 &&
    !paymentError &&
    covered &&
    !belowMinimum &&
    !quoteFailed &&
    !quotePending &&
    !creating;

  function addProduct(product: PublicMenuProduct, quantities: Quantities, quantity: number) {
    const result = addToCart(lines, product, quantities, quantity);
    if (!result.ok) setCartError(result.message);
    else {
      setCartError(null);
      onLinesChange(result.lines);
    }
  }

  function handleProductClick(product: PublicMenuProduct) {
    if (!product.available) return;
    setCartError(null);
    if (product.ingredients.length > 0) setProductDialog({ mode: "add", product });
    else addProduct(product, {}, 1);
  }

  function handleDialogConfirm(quantities: Quantities, quantity: number) {
    if (!productDialog) return;
    if (productDialog.mode === "add") {
      addProduct(productDialog.product, quantities, quantity);
    } else {
      const withoutLine = removeLine(lines, productDialog.line.key);
      const result = addToCart(withoutLine, productDialog.product, quantities, quantity);
      if (!result.ok) setCartError(result.message);
      else {
        setCartError(null);
        onLinesChange(result.lines);
      }
    }
    setProductDialog(null);
  }

  const filteredGroups = groups
    .filter((group) => category === null || group.name === category)
    .map((group) => ({
      ...group,
      products: group.products.filter((product) =>
        product.name.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    }))
    .filter((group) => group.products.length > 0);

  const summary = (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-base font-extrabold">Pedido</h3>
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 cursor-pointer rounded-lg px-2 text-sm font-bold text-link hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        >
          Editar detalles
        </button>
      </div>

      {lines.length === 0 ? (
        <p className="m-0 text-sm text-muted">Agregá productos del catálogo.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {lines.map((line) => {
            const product = products.get(line.productId);
            if (!product) return null;
            const changes = describeChanges(product.ingredients, line.choices);
            return (
              <li key={line.key} className="flex flex-col gap-1 py-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-ink">{product.name}</span>
                  <span className="shrink-0 font-bold text-ink">
                    {formatArs(lineTotalCents(product, line.choices, line.quantity))}
                  </span>
                </div>
                {changes.length > 0 && <span className="text-xs text-muted">{changes.join(", ")}</span>}
                <div className="flex flex-wrap items-center gap-2">
                  <LineStepper line={line} lines={lines} onLinesChange={onLinesChange} />
                  {product.ingredients.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setProductDialog({ mode: "edit", product, line })}
                      className="min-h-9 cursor-pointer rounded-lg px-2 text-xs font-bold text-link hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      Editar opciones
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onLinesChange(removeLine(lines, line.key))}
                    className="min-h-9 cursor-pointer rounded-lg px-2 text-xs font-bold text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    Borrar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <PaymentSection
        form={form}
        offeredPayments={offeredPayments}
        paymentError={paymentError}
        splitCents={splitCents ?? null}
        tenderedCents={tenderedCents ?? null}
        totalCents={totals.totalCents}
      />

      {tipVisible && (
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="text-xs font-bold text-muted">Propina para el repartidor (opcional)</legend>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={tipCents === 0}
              onClick={() => setValue("tipCents", 0)}
              className={cn(
                "min-h-9 cursor-pointer rounded-lg border px-2.5 text-xs font-bold",
                tipCents === 0 ? "border-primary bg-primary-soft" : "border-line bg-white",
              )}
            >
              Sin propina
            </button>
            {TIP_PERCENTAGES.map((percent) => {
              const amount = tipFromPercent(subtotalCents, percent);
              return (
                <button
                  key={percent}
                  type="button"
                  aria-pressed={tipCents === amount}
                  onClick={() => setValue("tipCents", amount)}
                  className={cn(
                    "min-h-9 cursor-pointer rounded-lg border px-2.5 text-xs font-bold",
                    tipCents === amount ? "border-primary bg-primary-soft" : "border-line bg-white",
                  )}
                >
                  {percent}% · {formatArs(amount)}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
        <div className="flex justify-between text-muted">
          <span>Subtotal</span>
          <span>{formatArs(totals.subtotalCents)}</span>
        </div>
        {fulfillment === "delivery" && (
          <div className="flex justify-between text-muted">
            <span>Envío</span>
            <span>
              {quotePending ? "Calculando…" : totals.shippingCents > 0 ? formatArs(totals.shippingCents) : "Gratis"}
            </span>
          </div>
        )}
        {totals.tipCents > 0 && (
          <div className="flex justify-between text-muted">
            <span>Propina</span>
            <span>{formatArs(totals.tipCents)}</span>
          </div>
        )}
        <div className="flex justify-between pt-1 text-base font-extrabold text-ink">
          <span>Total</span>
          <span aria-live="polite">{formatArs(totals.totalCents)}</span>
        </div>
      </div>

      {fulfillment === "delivery" && zones && !covered && !quotePending && (
        <Notice tone="error">La dirección está fuera de la zona de entrega.</Notice>
      )}
      {quoteFailed && <Notice tone="error">No pudimos calcular el envío. Probá de nuevo.</Notice>}
      {belowMinimum && minOrderCents !== null && (
        <Notice tone="warning">
          El pedido mínimo es {formatArs(minOrderCents)}. Te faltan {formatArs(minOrderCents - subtotalCents)}.
        </Notice>
      )}
      {paymentError && <p className="m-0 text-[13px] text-danger">{paymentError}</p>}
      {error && <Notice tone="error">{error}</Notice>}

      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
        <input type="checkbox" className="size-4 accent-primary" {...register("markPaid")} />
        Pago completo
      </label>

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          disabled={!canCreate}
          onClick={() =>
            onCreate({
              totalCents: totals.totalCents,
              tipCents: totals.tipCents,
              splitCashCents: paymentMethod === "split" ? (splitCents ?? null) : null,
              cashTenderedCents: paymentMethod === "transfer" ? null : (tenderedCents ?? null),
            })
          }
          className="min-h-12 w-full text-sm font-bold"
        >
          {creating ? "Creando…" : "Crear"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} className="min-h-11 w-full text-sm">
          Cancelar
        </Button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 pb-24 lg:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 font-display text-xl font-extrabold">Productos y pago</h2>
        <Button type="button" variant="outline" onClick={onBack} className="min-h-11 px-4 text-sm">
          Editar detalles
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className={cn("flex flex-col gap-3", showSummary && "hidden lg:flex")}>
          <Input
            aria-label="Buscar producto"
            placeholder="Buscar producto"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoComplete="off"
          />
          <div className="flex flex-wrap gap-1.5">
            <CategoryButton selected={category === null} onClick={() => setCategory(null)}>
              Todo
            </CategoryButton>
            {groups.map((group) => (
              <CategoryButton key={group.name} selected={category === group.name} onClick={() => setCategory(group.name)}>
                {group.name}
              </CategoryButton>
            ))}
          </div>

          {cartError && <Notice tone="error">{cartError}</Notice>}

          {filteredGroups.length === 0 ? (
            <p className="m-0 py-6 text-center text-sm text-muted">No hay productos con ese nombre.</p>
          ) : (
            filteredGroups.map((group) => (
              <div key={group.name} className="flex flex-col gap-2">
                <h3 className="m-0 text-xs font-bold text-muted">{group.name}</h3>
                <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
                  {group.products.map((product) => (
                    <li key={product.id}>
                      <button
                        type="button"
                        disabled={!product.available}
                        onClick={() => handleProductClick(product)}
                        className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-white px-3.5 py-2.5 text-left transition hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-semibold text-ink">{product.name}</span>
                          {!product.available && <span className="text-xs font-bold text-danger">Agotado</span>}
                        </span>
                        <span className="shrink-0 text-sm font-bold text-ink">{formatArs(product.priceCents)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>

        <aside className={cn("lg:sticky lg:top-4 lg:block lg:self-start", showSummary ? "block" : "hidden")}>
          {showSummary && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowSummary(false)}
              className="mb-2 min-h-11 w-full text-sm lg:hidden"
            >
              Volver al catálogo
            </Button>
          )}
          {summary}
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 border-t border-line bg-white p-3 lg:hidden">
        <span className="text-sm text-muted">
          Total <strong className="text-base text-ink">{formatArs(totals.totalCents)}</strong>
        </span>
        <Button type="button" onClick={() => setShowSummary(true)} className="min-h-11 px-5 text-sm font-bold">
          Ver pedido
        </Button>
      </div>

      {productDialog && (
        <ManualProductDialog
          product={productDialog.product}
          initialChoices={productDialog.mode === "edit" ? productDialog.line.choices : {}}
          initialQuantity={productDialog.mode === "edit" ? productDialog.line.quantity : 1}
          onConfirm={handleDialogConfirm}
          onClose={() => setProductDialog(null)}
        />
      )}
    </div>
  );
}

function CategoryButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "min-h-9 cursor-pointer rounded-lg px-3 text-xs font-bold",
        selected ? "bg-primary-soft text-ink" : "bg-tab text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function LineStepper({
  line,
  lines,
  onLinesChange,
}: {
  line: CartLine;
  lines: CartLine[];
  onLinesChange: (lines: CartLine[]) => void;
}) {
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        aria-label="Restar una unidad"
        onClick={() => onLinesChange(setLineQuantity(lines, line.key, line.quantity - 1))}
        className="size-9 cursor-pointer rounded-lg border border-line text-lg leading-none"
      >
        −
      </button>
      <span className="w-6 text-center text-xs font-bold">{line.quantity}</span>
      <button
        type="button"
        aria-label="Sumar una unidad"
        disabled={line.quantity >= MAX_LINE_QUANTITY}
        onClick={() => onLinesChange(setLineQuantity(lines, line.key, line.quantity + 1))}
        className="size-9 cursor-pointer rounded-lg border border-line text-lg leading-none disabled:opacity-50"
      >
        +
      </button>
    </span>
  );
}

function PaymentSection({
  form,
  offeredPayments,
  paymentError,
  splitCents,
  tenderedCents,
  totalCents,
}: {
  form: UseFormReturn<NewOrderFormValues>;
  offeredPayments: NewOrderFormValues["paymentMethod"][];
  paymentError: string | null;
  splitCents: number | null;
  tenderedCents: number | null;
  totalCents: number;
}) {
  const { register, watch } = form;
  const paymentMethod = watch("paymentMethod");
  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="text-xs font-bold text-muted">Medio de pago</legend>
      {offeredPayments.map((option) => (
        <label
          key={option}
          className={cn(
            "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3.5 text-sm",
            paymentMethod === option ? "border-primary bg-primary-soft font-bold" : "border-line bg-white",
          )}
        >
          <input type="radio" value={option} className="size-4 accent-primary" {...register("paymentMethod")} />
          {PAYMENT_LABELS[option]}
        </label>
      ))}

      {paymentMethod === "split" && (
        <label className="flex flex-col gap-1 text-xs font-bold text-muted">
          En efectivo
          <Input inputMode="numeric" autoComplete="off" {...register("splitCash")} />
        </label>
      )}

      {paymentMethod !== "transfer" && (
        <label className="flex flex-col gap-1 text-xs font-bold text-muted">
          ¿Con cuánto abona? <span className="font-normal">(opcional)</span>
          <Input inputMode="numeric" autoComplete="off" {...register("cashTendered")} />
        </label>
      )}

      {paymentMethod === "split" && splitCents !== null && splitCents > 0 && splitCents < totalCents && (
        <p className="m-0 text-sm text-muted">
          Por transferencia: <strong className="text-ink">{formatArs(totalCents - splitCents)}</strong>
        </p>
      )}
      {paymentError && <p className="m-0 text-[13px] text-danger">{paymentError}</p>}
      {tenderedCents !== null && paymentMethod !== "transfer" && (
        <p className="m-0 text-xs text-muted">Vuelto: {formatArs(Math.max(0, tenderedCents - (paymentMethod === "cash" ? totalCents : (splitCents ?? 0))))}</p>
      )}
    </fieldset>
  );
}
