import type { MerlinSpaceData, MerlinSpaceKind } from './types.js';

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

function mergeComparisonData(
  existing: MerlinSpaceData,
  patch: MerlinSpaceData,
  append: boolean,
): MerlinSpaceData {
  const existingColumns = existing.columns ?? [];
  const patchColumns = patch.columns ?? [];
  const columns =
    patchColumns.length > 0 ? unionColumns(existingColumns, patchColumns) : existingColumns;

  const existingRows = existing.rows ?? [];
  const patchRows = patch.rows ?? [];

  if (patchRows.length === 0) {
    return { ...existing, columns: columns.length > 0 ? columns : existing.columns };
  }

  const alignedPatchRows = patchRows.map((row) =>
    alignRowToColumns(row, columns, patchColumns.length > 0 ? patchColumns : columns),
  );

  if (!append || existingRows.length === 0) {
    return { ...existing, columns, rows: alignedPatchRows };
  }

  const alignedExisting = existingRows.map((row) =>
    alignRowToColumns(row, columns, existingColumns),
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

  return { ...existing, columns, rows: merged };
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
