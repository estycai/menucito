import { ComingSoon } from "@/components/ComingSoon";
import { NAV_ITEMS, type NavItem } from "@/lib/nav";

/** Route element of a section that is not built yet; the title comes from the nav config. */
export function ComingSoonPage({ id }: { id: NavItem["id"] }) {
  const item = NAV_ITEMS.find((candidate) => candidate.id === id);
  return <ComingSoon title={item?.title ?? ""} />;
}
