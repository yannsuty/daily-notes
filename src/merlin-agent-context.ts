import {
  deleteMerlinList,
  deleteMerlinReminder,
  getAllDays,
  getMerlinConversation,
  getMerlinCustomTools,
  getMerlinFacts,
  getMerlinLists,
  getMerlinReminders,
  saveMerlinCustomTool,
  saveMerlinList,
  saveMerlinReminder,
} from './db';
import type { AgentContext, AgentMutations } from '../lib/merlin-agent';

const MAX_CONTEXT_MESSAGES = 24;

export async function buildAgentContext(): Promise<AgentContext> {
  const [days, facts, lists, reminders, customTools, conv] = await Promise.all([
    getAllDays(),
    getMerlinFacts(),
    getMerlinLists(),
    getMerlinReminders(),
    getMerlinCustomTools(),
    getMerlinConversation(),
  ]);

  return {
    days,
    facts,
    lists,
    reminders,
    customTools,
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
}
