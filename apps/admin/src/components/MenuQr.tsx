import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { qrSvg, svgToPngBlob } from "@/lib/qr";

interface MenuQrProps {
  /** Full public menu URL the code points to. */
  href: string;
  /** Used for the downloaded file name. */
  slug: string;
}

/** QR of the public menu with its copy-link and download-PNG actions; lives in "Resumen". */
export function MenuQr({ href, slug }: MenuQrProps) {
  const svg = useMemo(() => qrSvg(href), [href]);
  const [status, setStatus] = useState<"copied" | "error" | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(href);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  async function download() {
    setDownloading(true);
    setStatus(null);
    try {
      const blob = await svgToPngBlob(svg);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `qr-${slug}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setStatus("error");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 sm:items-start">
      <img
        alt={`Código QR de tu menú: ${href}`}
        src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
        width={168}
        height={168}
        className="size-[168px] rounded-2xl border border-line bg-white"
      />
      <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
        <Button type="button" variant="outline" className="min-h-11 px-4 text-sm font-bold" onClick={() => void copyLink()}>
          Copiar link
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 px-4 text-sm font-bold"
          disabled={downloading}
          onClick={() => void download()}
        >
          {downloading ? "Generando…" : "Descargar QR"}
        </Button>
      </div>
      <p role="status" className="m-0 min-h-5 text-[13px] text-muted">
        {status === "copied" && "Link copiado"}
        {status === "error" && "No pudimos completar la acción. Probá de nuevo."}
      </p>
    </div>
  );
}
