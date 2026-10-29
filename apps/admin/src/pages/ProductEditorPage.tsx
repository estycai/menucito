import { useEffect, useId, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CATALOG_MESSAGES,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
  formatArs,
  parseArsPrice,
  type CategoryWithProducts,
  type Product,
} from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { FormField } from "@/components/FormField";
import { ProductPhotoUploader } from "@/components/ProductPhotoUploader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  useCatalog,
  useCreateProduct,
  useDeleteProduct,
  useProduct,
  useUpdateProduct,
  useUploadProductPhoto,
} from "@/lib/catalog";
import { planName } from "@/lib/plans";
import { ApiError, useMyRestaurant } from "@/lib/restaurant";
import { useDocumentTitle } from "@/lib/use-document-title";
import { cn } from "@/lib/utils";

/** Same rules as `createProductSchema`, with the price as typed (AR format) instead of cents. */
const productFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, CATALOG_MESSAGES.productNameRequired)
    .max(PRODUCT_NAME_MAX_LENGTH, CATALOG_MESSAGES.productNameTooLong),
  description: z.string().trim().max(PRODUCT_DESCRIPTION_MAX_LENGTH, CATALOG_MESSAGES.descriptionTooLong),
  categoryId: z.string().min(1, CATALOG_MESSAGES.categoryRequired),
  price: z
    .string()
    .trim()
    .min(1, CATALOG_MESSAGES.priceRequired)
    .refine((value) => parseArsPrice(value) !== null, CATALOG_MESSAGES.priceInvalid),
  available: z.boolean(),
});

type ProductFormValues = z.infer<typeof productFormSchema>;

/** Set when a new product was created but its photo could not be uploaded. */
interface EditorLocationState {
  photoError?: boolean;
}

const textareaClass =
  "box-border w-full resize-none rounded-xl border border-line bg-white p-3 text-base text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-danger";

/** "Editar producto" / "Nuevo producto": only the "Datos básicos" block of the canvas and its footer. */
export function ProductEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const product = useProduct(id);
  const notFound = product.error instanceof ApiError && product.error.status === 404;
  useDocumentTitle(id ? "Editar producto" : "Nuevo producto");

  useEffect(() => {
    if (notFound) navigate("/menu", { replace: true });
  }, [notFound, navigate]);

  if (catalog.isError || (product.isError && !notFound)) {
    return (
      <EditorShell title="Producto">
        <Notice tone="error">No pudimos cargar el producto. Recargá la página para intentar de nuevo.</Notice>
      </EditorShell>
    );
  }
  if (!catalog.data || (id && !product.data)) {
    return (
      <EditorShell title={id ? "Editar producto" : "Nuevo producto"}>
        <p className="m-0 text-muted">Cargando...</p>
      </EditorShell>
    );
  }

  // `key` remounts the form with fresh defaults when switching products.
  return (
    <ProductForm
      key={id ?? "new"}
      product={product.data ?? null}
      categories={catalog.data.categories}
      productPhotos={catalog.data.usage.productPhotos}
      atLimit={catalog.data.usage.maxProducts !== null && catalog.data.usage.products >= catalog.data.usage.maxProducts}
    />
  );
}

function EditorShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Link to="/menu" className="inline-flex min-h-11 items-center self-start text-sm font-bold text-link underline-offset-2 hover:underline">
          ← Volver a Mi menú
        </Link>
        <h1 className="m-0 font-display text-[28px] font-extrabold break-words sm:text-[32px]">{title}</h1>
      </div>
      {children}
    </div>
  );
}

function ProductForm({
  product,
  categories,
  productPhotos,
  atLimit,
}: {
  product: Product | null;
  categories: CategoryWithProducts[];
  productPhotos: boolean;
  atLimit: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { data: restaurant } = useMyRestaurant();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const uploadPhoto = useUploadProductPhoto();
  const [pendingPhoto, setPendingPhoto] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(
    (location.state as EditorLocationState | null)?.photoError
      ? "Guardamos el producto, pero no pudimos subir la foto. Probá de nuevo."
      : null,
  );
  const descriptionId = useId();
  const categoryFieldId = useId();

  const requestedCategory = params.get("category");
  const defaultCategory =
    product?.categoryId ?? categories.find((c) => c.id === requestedCategory)?.id ?? categories[0]?.id ?? "";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      name: product?.name ?? "",
      description: product?.description ?? "",
      categoryId: defaultCategory,
      price: product ? formatArs(product.priceCents) : "",
      available: product?.available ?? true,
    },
  });

  const isNew = !product;
  const backToMenu = (categoryId: string) => `/menu?category=${encodeURIComponent(categoryId)}`;
  const limitMessage = `Llegaste al límite de productos del plan ${planName(restaurant?.plan ?? "basic")}.`;

  async function onValid(values: ProductFormValues) {
    setError(null);
    const input = {
      name: values.name,
      description: values.description,
      categoryId: values.categoryId,
      priceCents: parseArsPrice(values.price) as number,
      available: values.available,
    };

    if (product) {
      try {
        await updateProduct.mutateAsync({ id: product.id, ...input });
        navigate(backToMenu(input.categoryId));
      } catch {
        setError("No pudimos guardar los cambios. Probá de nuevo.");
      }
      return;
    }

    let created: Product;
    try {
      created = await createProduct.mutateAsync(input);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === "PLAN_LIMIT"
          ? limitMessage
          : "No pudimos crear el producto. Revisá los datos y probá de nuevo.",
      );
      return;
    }
    if (pendingPhoto) {
      try {
        await uploadPhoto.mutateAsync({ id: created.id, webp: pendingPhoto });
      } catch {
        const state: EditorLocationState = { photoError: true };
        navigate(`/menu/products/${created.id}`, { replace: true, state });
        return;
      }
    }
    navigate(backToMenu(input.categoryId));
  }

  async function onDelete() {
    if (!product || !window.confirm(`¿Eliminar «${product.name}»? No se puede deshacer.`)) return;
    setError(null);
    try {
      await deleteProduct.mutateAsync(product.id);
      navigate(backToMenu(product.categoryId), { replace: true });
    } catch {
      setError("No pudimos eliminar el producto. Probá de nuevo.");
    }
  }

  const busy = isSubmitting || deleteProduct.isPending;

  return (
    <EditorShell title={product?.name ?? "Nuevo producto"}>
      {isNew && atLimit && <Notice tone="error">{limitMessage}</Notice>}
      <form noValidate onSubmit={handleSubmit(onValid)} className="flex flex-col gap-5">
        <section className="flex min-w-0 flex-col gap-[18px] rounded-2xl border border-line bg-white p-4 sm:p-6">
          <h2 className="m-0 font-display text-xl font-extrabold">Datos básicos</h2>

          <ProductPhotoUploader
            productId={product?.id}
            imageUrl={product?.imageUrl ?? null}
            allowed={productPhotos}
            pending={pendingPhoto}
            onPendingChange={setPendingPhoto}
          />

          <FormField label="Nombre" autoComplete="off" error={errors.name?.message} {...register("name")} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={descriptionId}>Descripción</Label>
            <textarea
              id={descriptionId}
              rows={3}
              className={textareaClass}
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={errors.description ? `${descriptionId}-error` : undefined}
              {...register("description")}
            />
            {errors.description?.message && (
              <p id={`${descriptionId}-error`} className="m-0 text-[13px] text-danger">
                {errors.description.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor={categoryFieldId}>Categoría</Label>
              <select
                id={categoryFieldId}
                className="box-border h-12 w-full min-w-0 rounded-xl border border-line bg-white px-3 text-base text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-danger"
                aria-invalid={errors.categoryId ? true : undefined}
                {...register("categoryId")}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              {errors.categoryId?.message && <p className="m-0 text-[13px] text-danger">{errors.categoryId.message}</p>}
            </div>
            <div className="min-w-0 flex-1">
              <FormField
                label="Precio"
                inputMode="decimal"
                autoComplete="off"
                placeholder="$ 9.000"
                error={errors.price?.message}
                {...register("price")}
              />
            </div>
          </div>

          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
            <input type="checkbox" className="m-0 size-5 accent-primary" {...register("available")} />
            Disponible para pedir
          </label>
        </section>

        {error && <Notice tone="error">{error}</Notice>}

        <div className={cn("flex flex-col-reverse gap-3 sm:flex-row sm:items-center", product ? "sm:justify-between" : "sm:justify-end")}>
          {product && (
            <Button
              type="button"
              variant="ghost"
              className="min-h-12 px-5 text-danger hover:bg-danger/5"
              disabled={busy}
              onClick={onDelete}
            >
              Eliminar producto
            </Button>
          )}
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <Button type="button" variant="outline" className="px-[22px]" disabled={busy} onClick={() => navigate(backToMenu(defaultCategory))}>
              Cancelar
            </Button>
            <Button type="submit" className="min-h-12 w-full rounded-xl px-[26px] text-[15px] sm:w-auto" disabled={busy || (isNew && atLimit)}>
              Guardar
            </Button>
          </div>
        </div>
      </form>
    </EditorShell>
  );
}
