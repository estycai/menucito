import { initials } from "@/lib/initials";
import { cn } from "@/lib/utils";

const SIZES = {
  md: "size-16 rounded-2xl text-[22px]",
  lg: "size-20 rounded-[20px] text-[26px]",
} as const;

/** Restaurant logo, or its initials on the primary color when there is no logo. */
export function RestaurantAvatar({
  name,
  logoUrl,
  size = "md",
  className,
}: {
  name: string;
  logoUrl: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const base = cn("flex shrink-0 items-center justify-center overflow-hidden", SIZES[size], className);
  if (logoUrl) {
    return <img src={logoUrl} alt={`Logo de ${name}`} className={cn(base, "border border-line bg-white object-contain")} />;
  }
  return (
    <span aria-hidden="true" className={cn(base, "bg-primary font-display font-extrabold text-white")}>
      {initials(name)}
    </span>
  );
}
