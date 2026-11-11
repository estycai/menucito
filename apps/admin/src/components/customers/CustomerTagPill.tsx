import type { CustomerTag, CustomerTagColor } from "@menucito/shared";
import { cn } from "@/lib/utils";

/** Fixed palette of customer tags; the classes are literal so Tailwind keeps them. */
export const TAG_COLOR_CLASSES: Record<CustomerTagColor, string> = {
  orange: "border-orange-200 bg-orange-100 text-orange-800",
  blue: "border-blue-200 bg-blue-100 text-blue-800",
  green: "border-green-200 bg-green-100 text-green-800",
  purple: "border-purple-200 bg-purple-100 text-purple-800",
  pink: "border-pink-200 bg-pink-100 text-pink-800",
  teal: "border-teal-200 bg-teal-100 text-teal-800",
  amber: "border-amber-200 bg-amber-100 text-amber-800",
  gray: "border-line bg-tab text-muted",
};

export const TAG_COLOR_LABELS: Record<CustomerTagColor, string> = {
  orange: "Naranja",
  blue: "Azul",
  green: "Verde",
  purple: "Violeta",
  pink: "Rosa",
  teal: "Turquesa",
  amber: "Ámbar",
  gray: "Gris",
};

export function CustomerTagPill({ tag, className }: { tag: CustomerTag; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-[11px] font-bold",
        TAG_COLOR_CLASSES[tag.color],
        className,
      )}
    >
      {tag.name}
    </span>
  );
}
