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

describe("sortReportRows with empty values", () => {
  it("keeps the rows without data last in both directions", () => {
    const rows = [{ m: 12.5 }, { m: "" as const }, { m: 9.5 }, { m: 30 }];
    const columns = [{ key: "m", kind: "count" as const, value: (row: { m: number | "" }) => row.m }];
    expect(sortReportRows(rows, columns, { key: "m", direction: "asc" }).map((row) => row.m)).toEqual([9.5, 12.5, 30, ""]);
    expect(sortReportRows(rows, columns, { key: "m", direction: "desc" }).map((row) => row.m)).toEqual([30, 12.5, 9.5, ""]);
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
