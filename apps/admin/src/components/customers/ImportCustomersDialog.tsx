import { useState, type ChangeEvent } from "react";
import {
  CUSTOMER_IMPORT_BATCH_SIZE,
  customerCsvTemplate,
  customerImportErrorsCsv,
  parseCustomersCsv,
  type CustomerImportResult,
  type ParsedCustomerCsvRow,
} from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { useImportCustomers } from "@/lib/customers";
import { ApiError } from "@/lib/restaurant";

/** "Importar clientes": reads the CSV in the browser, uploads it in batches and reports the result. */
export function ImportCustomersDialog({ onClose }: { onClose: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedCustomerCsvRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<CustomerImportResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importCustomers = useImportCustomers();

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setResult(null);
    setImportError(null);
    setParseError(null);
    setRows(null);
    setFileName(file?.name ?? null);
    if (!file) return;
    const parsed = parseCustomersCsv(await file.text());
    if (!parsed.ok) {
      setParseError(parsed.message);
      return;
    }
    setRows(parsed.rows);
  }

  async function start() {
    if (!rows) return;
    setImportError(null);
    setResult(null);
    const total = rows.length;
    let created = 0;
    let updated = 0;
    const errors: CustomerImportResult["errors"] = [];
    setProgress({ done: 0, total });
    try {
      for (let startIndex = 0; startIndex < rows.length; startIndex += CUSTOMER_IMPORT_BATCH_SIZE) {
        const batch = rows.slice(startIndex, startIndex + CUSTOMER_IMPORT_BATCH_SIZE);
        const partial = await importCustomers.mutateAsync({ rows: batch });
        created += partial.created;
        updated += partial.updated;
        errors.push(...partial.errors);
        setProgress({ done: Math.min(total, startIndex + batch.length), total });
      }
      setResult({ created, updated, errors });
    } catch (error) {
      setImportError(
        error instanceof ApiError && error.message ? error.message : "No pudimos importar el archivo. Probá de nuevo.",
      );
    } finally {
      setProgress(null);
    }
  }

  function download(name: string, content: string) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  return (
    <Modal title="Importar clientes" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="m-0 text-sm text-muted">
          Subí un CSV de hasta 1.000 filas con las columnas Nombre, Teléfono, Dirección, Notas y Etiquetas. Si un teléfono
          ya existe, solo se completan los datos vacíos y se suman las etiquetas.
        </p>

        <Button
          type="button"
          variant="outline"
          onClick={() => download("modelo-clientes.csv", customerCsvTemplate())}
          className="min-h-11 self-start px-4 text-sm"
        >
          Descargar modelo
        </Button>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold">Archivo CSV</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void readFile(event)}
            disabled={Boolean(progress)}
            className="box-border w-full cursor-pointer rounded-xl border border-line bg-white p-2.5 text-sm file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-sm file:font-bold file:text-primary"
          />
        </label>

        {fileName && rows && (
          <p className="m-0 text-sm text-ink">
            <b>{fileName}</b>: {rows.length} {rows.length === 1 ? "fila lista" : "filas listas"} para importar.
          </p>
        )}
        {parseError && <Notice tone="error">{parseError}</Notice>}
        {importError && <Notice tone="error">{importError}</Notice>}

        {progress && (
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted">
              Importando {progress.done} de {progress.total}…
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-tab">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-bg/40 p-4">
            <p className="m-0 text-sm font-bold">
              {result.created} importados · {result.updated} actualizados · {result.errors.length} con error
            </p>
            {result.errors.length > 0 && (
              <div className="flex flex-col gap-2">
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-muted">
                  {result.errors.slice(0, 5).map((error) => (
                    <li key={`${error.row}-${error.message}`}>
                      Fila {error.row}: {error.message}
                    </li>
                  ))}
                  {result.errors.length > 5 && <li>y {result.errors.length - 5} más…</li>}
                </ul>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => download("errores-clientes.csv", customerImportErrorsCsv(rows ?? [], result.errors))}
                  className="min-h-10 self-start px-4 text-sm"
                >
                  Descargar errores
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={Boolean(progress)} className="min-h-11 px-5">
            {result ? "Cerrar" : "Cancelar"}
          </Button>
          <Button
            type="button"
            onClick={() => void start()}
            disabled={!rows || rows.length === 0 || Boolean(progress)}
            className="min-h-11 px-5 text-sm"
          >
            {progress ? "Importando…" : "Importar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
