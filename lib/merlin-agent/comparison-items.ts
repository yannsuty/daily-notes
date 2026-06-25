import type { MerlinSpaceData } from './types.js';
import { normalizeComparisonData } from './space-merge.js';

/** Clé stable d'une ligne (première colonne, ex. nom du produit). */
export function comparisonRowKey(row: string[]): string {
  return (row[0] ?? '').trim().toLowerCase();
}

export interface ComparisonRowEntry {
  row: string[];
  key: string;
  sourceIndex: number;
}

export function listComparisonRows(data: MerlinSpaceData): ComparisonRowEntry[] {
  const { rows = [] } = normalizeComparisonData(data);
  return rows.map((row, sourceIndex) => ({
    row,
    key: comparisonRowKey(row),
    sourceIndex,
  }));
}

export function getIgnoredRowKeys(data: MerlinSpaceData): Set<string> {
  return new Set((data.ignoredRows ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean));
}

export function getVisibleComparisonRows(data: MerlinSpaceData): ComparisonRowEntry[] {
  const ignored = getIgnoredRowKeys(data);
  return listComparisonRows(data).filter((entry) => !ignored.has(entry.key) || !entry.key);
}

export function getIgnoredComparisonRows(data: MerlinSpaceData): ComparisonRowEntry[] {
  const ignored = getIgnoredRowKeys(data);
  return listComparisonRows(data).filter((entry) => ignored.has(entry.key) && entry.key);
}

export function ignoreComparisonRow(data: MerlinSpaceData, rowKey: string): MerlinSpaceData {
  const key = rowKey.trim().toLowerCase();
  if (!key) return data;
  const ignored = getIgnoredRowKeys(data);
  if (ignored.has(key)) return data;
  return { ...data, ignoredRows: [...(data.ignoredRows ?? []), key] };
}

export function restoreComparisonRow(data: MerlinSpaceData, rowKey: string): MerlinSpaceData {
  const key = rowKey.trim().toLowerCase();
  if (!key) return data;
  const next = (data.ignoredRows ?? []).filter((k) => k.trim().toLowerCase() !== key);
  if (next.length === (data.ignoredRows ?? []).length) return data;
  return { ...data, ignoredRows: next.length > 0 ? next : undefined };
}
