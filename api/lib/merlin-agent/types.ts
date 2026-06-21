export interface DayEntry {
  content: string;
  updatedAt: number;
}

export interface MerlinMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface MerlinFact {
  id: string;
  key: string;
  value: string;
  source: 'explicit' | 'inferred';
  createdAt: number;
  updatedAt: number;
}

export interface MerlinListItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MerlinList {
  id: string;
  title: string;
  items: MerlinListItem[];
  createdAt: number;
  updatedAt: number;
}

export type MerlinReminderRecurrence = 'once' | 'daily' | 'weekly';

export type MerlinReminderTrigger =
  | { kind: 'time'; at?: number; timeOfDay?: string; recurrence?: MerlinReminderRecurrence }
  | { kind: 'context'; tags: string[] };

export type MerlinReminderStatus = 'active' | 'done' | 'snoozed';

export interface MerlinReminder {
  id: string;
  text: string;
  trigger: MerlinReminderTrigger;
  status: MerlinReminderStatus;
  createdAt: number;
  updatedAt: number;
}

export interface MerlinToolStep {
  tool: string;
  args: Record<string, string>;
}

export interface MerlinCustomToolParam {
  name: string;
  description: string;
}

export interface MerlinCustomTool {
  id: string;
  name: string;
  description: string;
  steps: MerlinToolStep[];
  params?: MerlinCustomToolParam[];
  source: 'auto' | 'user';
  usageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentContext {
  days: Record<string, DayEntry>;
  facts: MerlinFact[];
  lists: MerlinList[];
  reminders: MerlinReminder[];
  customTools: MerlinCustomTool[];
  conversationSummary: string;
  recentMessages: MerlinMessage[];
}

export type AgentStepPhase =
  | 'analyze'
  | 'plan'
  | 'memory'
  | 'tool'
  | 'think'
  | 'synthesize'
  | 'respond';

export interface AgentStep {
  phase: AgentStepPhase;
  label: string;
  detail?: string;
}

export type AgentSideEffect = 'list_updated' | 'reminder_created' | 'reminder_completed';

export interface AgentMutations {
  lists?: MerlinList[];
  reminders?: MerlinReminder[];
  facts?: MerlinFact[];
  customTools?: MerlinCustomTool[];
}

export interface AgentRunResult {
  ok: boolean;
  reply?: string;
  error?: string;
  steps: AgentStep[];
  mutations: AgentMutations;
  sideEffects?: AgentSideEffect;
  depth: QueryDepth;
}

export type QueryDepth = 'standard' | 'deep';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AgentClientConfig {
  apiKey?: string;
  modelChain?: string;
  model?: string;
}

export interface AgentRequestBody {
  message: string;
  context: AgentContext;
  config?: AgentClientConfig;
  stream?: boolean;
}

export interface ToolResult {
  ok: boolean;
  content: string;
  mutation?: AgentSideEffect;
}
