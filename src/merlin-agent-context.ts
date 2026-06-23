import {
  deleteMerlinList,
  deleteMerlinReminder,
  deleteMerlinSpace,
  getAllDays,
  getMerlinConversation,
  getMerlinCustomTools,
  getMerlinFacts,
  getMerlinLists,
  getMerlinReminders,
  getMerlinSpaces,
  saveMerlinCustomTool,
  saveMerlinList,
  saveMerlinReminder,
  saveMerlinSpace,
} from './db';
import { getActiveSpaceId } from './merlin-space-session';
import type { AgentContext, AgentMutations } from '../lib/merlin-agent';

const MAX_CONTEXT_MESSAGES = 24;

export async function buildAgentContext(): Promise<AgentContext> {
  const [days, facts, lists, reminders, customTools, spaces, conv] = await Promise.all([
    getAllDays(),
    getMerlinFacts(),
    getMerlinLists(),
    getMerlinReminders(),
    getMerlinCustomTools(),
    getMerlinSpaces(),
    getMerlinConversation(),
  ]);

  const activeSpaceId = getActiveSpaceId();
  const activeSpace = activeSpaceId
    ? spaces.find((s) => s.id === activeSpaceId) ?? null
    : null;

  return {
    days,
    facts,
    lists,
    reminders,
    customTools,
    spaces,
    activeSpaceId,
    activeSpace,
    conversationSummary: conv.summary,
    recentMessages: conv.messages.slice(-MAX_CONTEXT_MESSAGES),
  };
}

export async function applyAgentMutations(mutations: AgentMutations): Promise<void> {
  if (mutations.lists) {
    const existing = await getMerlinLists();
    const nextIds = new Set(mutations.lists.map((list) => list.id));
    for (const list of existing) {
      if (!nextIds.has(list.id)) {
        await deleteMerlinList(list.id);
      }
    }
    for (const list of mutations.lists) {
      await saveMerlinList(list);
    }
  }

  if (mutations.reminders) {
    const existing = await getMerlinReminders();
    const nextIds = new Set(mutations.reminders.map((r) => r.id));
    for (const reminder of existing) {
      if (!nextIds.has(reminder.id)) {
        await deleteMerlinReminder(reminder.id);
      }
    }
    for (const reminder of mutations.reminders) {
      await saveMerlinReminder(reminder);
    }
    const { rescheduleMerlinReminders } = await import('./merlin-scheduler');
    void rescheduleMerlinReminders();
  }

  if (mutations.customTools) {
    for (const tool of mutations.customTools) {
      await saveMerlinCustomTool(tool);
    }
  }

  if (mutations.spaces) {
    const existing = await getMerlinSpaces();
    const nextIds = new Set(mutations.spaces.map((s) => s.id));
    for (const space of existing) {
      if (!nextIds.has(space.id)) {
        await deleteMerlinSpace(space.id);
      }
    }
    for (const space of mutations.spaces) {
      await saveMerlinSpace(space);
    }
  }
}
