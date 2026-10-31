import { useSetFeaturedCategory } from "@/lib/catalog";
import { cn } from "@/lib/utils";

/**
 * Star button of a category header. Only one category is featured: marking this one moves the star
 * from the previous one (the API does it atomically). Available on every plan.
 */
export function FeaturedToggle({
  categoryId,
  categoryName,
  featured,
  onError,
}: {
  categoryId: string;
  categoryName: string;
  featured: boolean;
  /** Called when the request fails, so the section can show its error notice. */
  onError: () => void;
}) {
  const { mutate, isPending } = useSetFeaturedCategory();
  return (
    <button
      type="button"
      aria-pressed={featured}
      aria-label={`${featured ? "Destacada" : "Destacar"}: ${categoryName}`}
      disabled={isPending}
      onClick={() => mutate({ id: categoryId, featured: !featured }, { onError })}
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-[10px] border px-3.5 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60",
        featured ? "border-[#FDBA74] bg-nav-active text-link" : "border-line bg-white text-ink",
      )}
    >
      <span aria-hidden="true" className="text-base leading-none">
        {featured ? "★" : "☆"}
      </span>
      {featured ? "Destacada" : "Destacar"}
    </button>
  );
}
