import type { MerlinSpaceData, MerlinSpaceKind } from './types.js';

function findColumnIndex(columns: string[], pattern: RegExp, fallback: number): number {
  const idx = columns.findIndex((c) => pattern.test(c));
  return idx >= 0 ? idx : fallback;
}

function isLikelyDiameter(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return /\d+\s*["″']\s*\(\s*\d+/i.test(v) || /^\d+\s*["″']\s*$/i.test(v);
}

function isLikelyPrice(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return /€/.test(v) || /\d+\s*[-–]\s*\d+/.test(v);
}

function scoreComparisonRow(row: string[], columns: string[]): number {
  const dIdx = findColumnIndex(columns, /diam/i, 2);
  const pIdx = findColumnIndex(columns, /prix/i, 1);
  let score = 0;
  if (isLikelyDiameter(row[dIdx] ?? '')) score += 3;
  if (isLikelyPrice(row[pIdx] ?? '')) score += 2;
  return score;
}

/** Supprime les cellules vides parasites (ex. `["Philips Classic 44", "", "150-200"]`). */
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

/** Répare une ligne trop longue ou décalée (colonne en trop après le modèle). */
export function repairComparisonRow(row: string[], columns: string[]): string[] {
  const n = columns.length;
  if (n === 0) return row.map((c) => String(c ?? ''));

  let cells = compactSpuriousEmptyCells(row.map((c) => (c == null ? '' : String(c))));
  const dIdx = findColumnIndex(columns, /diam/i, 2);

  if (cells.length === n && !isLikelyDiameter(cells[dIdx] ?? '')) {
    if (dIdx > 0 && isLikelyDiameter(cells[dIdx - 1] ?? '')) {
      const trial = cells.filter((_, i) => i !== dIdx - 1);
      if (trial.length === n - 1) {
        const padded = normalizeComparisonRow(trial, n);
        if (isLikelyDiameter(padded[dIdx] ?? '')) cells = padded;
      }
    }
  }

  if (cells.length === n + 1) {
    let best: string[] | null = null;
    let bestScore = scoreComparisonRow(cells.slice(0, n), columns) - 1;

    for (let remove = 0; remove < cells.length; remove++) {
      const trial = cells.filter((_, i) => i !== remove);
      if (trial.length !== n) continue;
      const score = scoreComparisonRow(trial, columns);
      const bonus = remove > 0 && remove <= dIdx ? 1 : 0;
      if (score + bonus > bestScore) {
        bestScore = score + bonus;
        best = trial;
      }
    }
    if (best && bestScore >= 3) return best;
  }

  if (cells.length > n) {
    return cells.slice(0, n);
  }
  if (cells.length < n) {
    return [...cells, ...Array(n - cells.length).fill('')];
  }
  return cells;
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

/** Aligne et répare chaque ligne du tableau comparatif. */
export function normalizeComparisonData(data: MerlinSpaceData): MerlinSpaceData {
  const columns = (data.columns ?? []).map((c) => String(c).trim());
  if (columns.length === 0) return data;

  const rows = (data.rows ?? []).map((row) => repairComparisonRow(row, columns));
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
      repairComparisonRow(row, columns),
      columns,
      patchColumns.length > 0 ? patchColumns : columns,
    ),
  );

  const replaceAll =
    !append ||
    existingRows.length === 0 ||
    isFullComparisonReplace(normalizedExisting, normalizedPatch, append);

  if (replaceAll) {
    return normalizeComparisonData({ ...normalizedExisting, columns, rows: alignedPatchRows });
  }

  const alignedExisting = existingRows.map((row) =>
    alignRowToColumns(repairComparisonRow(row, columns), columns, existingColumns),
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
