import { getMerlinShortcuts, saveMerlinShortcut } from './db';
import type { MerlinShortcut } from './types';
import { createEntityId } from './merlin-tools';

export async function getPaletteShortcuts(limit = 6): Promise<MerlinShortcut[]> {
  const shortcuts = await getMerlinShortcuts();
  const pinned = shortcuts.filter((s) => s.pinned);
  const unpinned = shortcuts
    .filter((s) => !s.pinned)
    .sort((a, b) => b.usageCount - a.usageCount || b.lastUsedAt - a.lastUsedAt);
  return [...pinned, ...unpinned].slice(0, limit);
}

export async function recordShortcutUsage(prompt: string, label?: string): Promise<void> {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized || normalized.length < 4) return;

  const shortcuts = await getMerlinShortcuts();
  const existing = shortcuts.find((s) => s.prompt.trim().toLowerCase() === normalized);

  const now = Date.now();
  if (existing) {
    existing.usageCount += 1;
    existing.lastUsedAt = now;
    await saveMerlinShortcut(existing);
    return;
  }

  const similar = shortcuts.filter(
    (s) => s.prompt.trim().toLowerCase().slice(0, 20) === normalized.slice(0, 20),
  );
  if (similar.length >= 1) {
    similar[0].usageCount += 1;
    similar[0].lastUsedAt = now;
    await saveMerlinShortcut(similar[0]);
    return;
  }

  if (shortcuts.filter((s) => s.source === 'auto').length >= 12) return;

  const shortcut: MerlinShortcut = {
    id: createEntityId(),
    label: label ?? prompt.slice(0, 24),
    prompt,
    pinned: false,
    usageCount: 1,
    source: 'auto',
    lastUsedAt: now,
    createdAt: now,
  };
  await saveMerlinShortcut(shortcut);
}

export async function recordToolAsShortcut(
  toolName: string,
  args: Record<string, string>,
): Promise<void> {
  const labels: Record<string, string> = {
    add_list_item: `+ ${args.item ?? 'item'}`,
    create_reminder: `⏰ ${args.text?.slice(0, 20) ?? 'Rappel'}`,
    trigger_context: `📍 ${args.tags ?? 'contexte'}`,
    show_lists: '📋 Listes',
  };
  const label = labels[toolName];
  if (!label) return;

  const promptParts = [toolName, ...Object.values(args)].filter(Boolean);
  await recordShortcutUsage(promptParts.join(' '), label);
}

export async function toggleShortcutPin(id: string): Promise<void> {
  const shortcuts = await getMerlinShortcuts();
  const shortcut = shortcuts.find((s) => s.id === id);
  if (!shortcut) return;
  shortcut.pinned = !shortcut.pinned;
  await saveMerlinShortcut(shortcut);
}

export async function deleteShortcut(id: string): Promise<void> {
  const { deleteMerlinShortcut } = await import('./db');
  await deleteMerlinShortcut(id);
}
