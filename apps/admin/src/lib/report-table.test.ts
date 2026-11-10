import { describe, expect, it } from "vitest";
import { nextSort, sortReportRows, type ReportSortableColumn } from "./report-table";

interface Row {
  name: string;
  units: number;
}

const columns: ReportSortableColumn<Row>[] = [
  { key: "name", kind: "text", value: (row) => row.name },
  { key: "units", kind: "count", value: (row) => row.units },
];

const rows: Row[] = [
  { name: "Zapallo", units: 2 },
  { name: "Árabe", units: 10 },
  { name: "milanesa", units: 5 },
];

describe("sortReportRows", () => {
  it("sorts text ignoring case and accents, in both directions", () => {
    expect(sortReportRows(rows, columns, { key: "name", direction: "asc" }).map((row) => row.name)).toEqual(["Árabe", "milanesa", "Zapallo"]);
    expect(sortReportRows(rows, columns, { key: "name", direction: "desc" }).map((row) => row.name)).toEqual(["Zapallo", "milanesa", "Árabe"]);
  });

  it("sorts numbers and keeps the original order without a known column", () => {
    expect(sortReportRows(rows, columns, { key: "units", direction: "desc" }).map((row) => row.units)).toEqual([10, 5, 2]);
    expect(sortReportRows(rows, columns, null)).toEqual(rows);
    expect(sortReportRows(rows, columns, { key: "missing", direction: "asc" })).toEqual(rows);
  });

  it("does not mutate the rows it receives", () => {
    const original = [...rows];
    sortReportRows(rows, columns, { key: "units", direction: "asc" });
    expect(rows).toEqual(original);
  });
});

describe("nextSort", () => {
  it("starts numbers from the biggest and text from A, and flips on a second tap", () => {
    expect(nextSort(null, "units", "count")).toEqual({ key: "units", direction: "desc" });
    expect(nextSort(null, "revenue", "money")).toEqual({ key: "revenue", direction: "desc" });
    expect(nextSort(null, "name", "text")).toEqual({ key: "name", direction: "asc" });
    expect(nextSort({ key: "units", direction: "desc" }, "units", "count")).toEqual({ key: "units", direction: "asc" });
    expect(nextSort({ key: "units", direction: "desc" }, "name", "text")).toEqual({ key: "name", direction: "asc" });
  });
});
