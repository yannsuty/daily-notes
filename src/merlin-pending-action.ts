import { createMessageId } from './merlin-agent';
import {
  buildConfirmationPrompt,
  describeAutomation,
  executeAutomationAction,
  isAccessibilityEnabled,
  type AutomationSummary,
} from './merlin-automation';
import { CONFIRM_PHRASES, CANCEL_PHRASES, matchesPhrase } from './merlin-text';

export interface PendingAutomation {
  id: string;
  toolArgs: Record<string, string>;
  summary: AutomationSummary;
  createdAt: number;
}

let pending: PendingAutomation | null = null;

export function getPendingAutomation(): PendingAutomation | null {
  return pending;
}

export function clearPendingAutomation(): void {
  pending = null;
}

export function stagePendingAutomation(args: Record<string, string>): PendingAutomation | null {
  const summary = describeAutomation(args);
  if (!summary) return null;

  pending = {
    id: createMessageId(),
    toolArgs: { ...args },
    summary,
    createdAt: Date.now(),
  };
  return pending;
}

export function buildConfirmationMessage(staged: PendingAutomation): string {
  return buildConfirmationPrompt(staged.summary);
}

export async function confirmPendingAutomation(): Promise<{ ok: boolean; content: string }> {
  const current = pending;
  if (!current) {
    return { ok: false, content: 'Aucune action en attente de confirmation.' };
  }

  clearPendingAutomation();

  if (current.summary.needsAccessibility) {
    const enabled = await isAccessibilityEnabled();
    if (!enabled) {
      const { openAccessibilitySettings } = await import('./merlin-automation');
      await openAccessibilitySettings();
      return {
        ok: false,
        content:
          "Le service d'accessibilité Merlin doit être activé. Ouvrez les réglages, activez Merlin, puis relancez l'action.",
      };
    }
  }

  return executeAutomationAction(current.toolArgs);
}

export function cancelPendingAutomation(): string {
  if (!pending) {
    return 'Aucune action en attente.';
  }
  clearPendingAutomation();
  return "D'accord, j'annule l'action.";
}

export async function tryResolvePendingAutomation(
  userText: string,
): Promise<{ handled: boolean; ok: boolean; content: string } | null> {
  if (!pending) return null;

  if (matchesPhrase(userText, CONFIRM_PHRASES)) {
    const result = await confirmPendingAutomation();
    return { handled: true, ok: result.ok, content: result.content };
  }

  if (matchesPhrase(userText, CANCEL_PHRASES)) {
    const reply = cancelPendingAutomation();
    return { handled: true, ok: true, content: reply };
  }

  return null;
}
