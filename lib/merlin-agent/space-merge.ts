import type { MerlinSpaceData, MerlinSpaceKind } from './types.js';

/** Supprime les cellules vides parasites (ex. `["Philips Classic 44", "", "150-200"]` après JSON mal échappé). */
function compactSpuriousEmptyCells(cells: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell === '' && out.length > 0 && i + 1 < cells.length && cells[i + 1] !== '') {
      continue;
    }
    out.push(cell);
  }
  return out;
}

export function normalizeComparisonRow(row: string[], columnCount: number): string[] {
  const cells = compactSpuriousEmptyCells(row.map((c) => (c == null ? '' : String(c))));
  if (cells.length > columnCount) {
    return cells.slice(0, columnCount);
  }
  if (cells.length < columnCount) {
    return [...cells, ...Array(columnCount - cells.length).fill('')];
  }
  return cells;
}

/** Aligne chaque ligne sur le nombre de colonnes (tronque ou complète). */
export function normalizeComparisonData(data: MerlinSpaceData): MerlinSpaceData {
  const columns = (data.columns ?? []).map((c) => String(c).trim());
  if (columns.length === 0) return data;

  const rows = (data.rows ?? []).map((row) => normalizeComparisonRow(row, columns.length));
  return { ...data, columns, rows };
}

function unionColumns(existing: string[], incoming: string[]): string[] {
  const result = [...existing];
  for (const col of incoming) {
    if (!result.includes(col)) result.push(col);
  }
  return result;
}

function alignRowToColumns(row: string[], columns: string[], sourceColumns: string[]): string[] {
  return columns.map((col) => {
    const idx = sourceColumns.indexOf(col);
    return idx >= 0 ? (row[idx] ?? '') : '';
  });
}

function isFullComparisonReplace(
  existing: MerlinSpaceData,
  patch: MerlinSpaceData,
  append: boolean,
): boolean {
  if (!append) return false;
  const patchColumns = patch.columns ?? [];
  const patchRows = patch.rows ?? [];
  const existingRows = existing.rows ?? [];
  if (patchColumns.length === 0 || patchRows.length === 0) return false;
  return (
    patchRows.length >= existingRows.length &&
    patchColumns.length >= (existing.columns?.length ?? 0)
  );
}

function mergeComparisonData(
  existing: MerlinSpaceData,
  patch: MerlinSpaceData,
  append: boolean,
): MerlinSpaceData {
  const normalizedPatch = normalizeComparisonData(patch);
  const normalizedExisting = normalizeComparisonData(existing);

  const existingColumns = normalizedExisting.columns ?? [];
  const patchColumns = normalizedPatch.columns ?? [];
  const columns =
    patchColumns.length > 0 ? unionColumns(existingColumns, patchColumns) : existingColumns;

  const existingRows = normalizedExisting.rows ?? [];
  const patchRows = normalizedPatch.rows ?? [];

  if (patchRows.length === 0) {
    return normalizeComparisonData({
      ...normalizedExisting,
      columns: columns.length > 0 ? columns : normalizedExisting.columns,
    });
  }

  const alignedPatchRows = patchRows.map((row) =>
    alignRowToColumns(
      normalizeComparisonRow(row, columns.length),
      columns,
      patchColumns.length > 0 ? patchColumns : columns,
    ),
  );

  const replaceAll =
    !append || existingRows.length === 0 || isFullComparisonReplace(normalizedExisting, normalizedPatch, append);

  if (replaceAll) {
    return normalizeComparisonData({ ...normalizedExisting, columns, rows: alignedPatchRows });
  }

  const alignedExisting = existingRows.map((row) =>
    alignRowToColumns(
      normalizeComparisonRow(row, columns.length),
      columns,
      existingColumns,
    ),
  );

  const rowKey = (row: string[]) => (row[0] ?? '').trim().toLowerCase();
  const merged = [...alignedExisting];

  for (const newRow of alignedPatchRows) {
    const key = rowKey(newRow);
    const idx = merged.findIndex((r) => rowKey(r) === key && key.length > 0);
    if (idx >= 0) {
      merged[idx] = newRow;
    } else {
      merged.push(newRow);
    }
  }

  return normalizeComparisonData({ ...normalizedExisting, columns, rows: merged });
}

function mergeRecipeData(
  existing: MerlinSpaceData,
  patch: MerlinSpaceData,
  append: boolean,
): MerlinSpaceData {
  const ingredients = append
    ? [...(existing.ingredients ?? []), ...(patch.ingredients ?? [])]
    : (patch.ingredients ?? existing.ingredients);
  const steps = append
    ? [...(existing.steps ?? []), ...(patch.steps ?? [])]
    : (patch.steps ?? existing.steps);
  return {
    ...existing,
    ...patch,
    servings: patch.servings ?? existing.servings,
    ingredients,
    steps,
  };
}

export function mergeSpaceData(
  kind: MerlinSpaceKind,
  existing: MerlinSpaceData,
  patch: MerlinSpaceData,
  options?: { append?: boolean },
): MerlinSpaceData {
  const append = options?.append ?? false;

  if (kind === 'comparison') {
    return mergeComparisonData(existing, patch, append);
  }

  if (kind === 'recipe') {
    return mergeRecipeData(existing, patch, append);
  }

  if (append && kind === 'diy') {
    return {
      ...existing,
      ...patch,
      sections: [...(existing.sections ?? []), ...(patch.sections ?? [])],
    };
  }

  if (append && kind === 'plan') {
    return {
      ...existing,
      ...patch,
      milestones: [...(existing.milestones ?? []), ...(patch.milestones ?? [])],
    };
  }

  return { ...existing, ...patch };
}
