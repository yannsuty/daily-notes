export interface DayEntry {
  content: string;
  updatedAt: number;
}

export interface MerlinMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  updatedAt?: number;
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

export type MerlinSpaceKind = 'comparison' | 'diy' | 'plan' | 'recipe';

export interface MerlinSpaceSection {
  id: string;
  title: string;
  content: string;
}

export interface MerlinSpaceIngredient {
  id: string;
  text: string;
  quantity?: string;
  unit?: string;
}

export interface MerlinSpaceStep {
  id: string;
  order: number;
  text: string;
}

export interface MerlinSpaceMilestone {
  id: string;
  title: string;
  done: boolean;
}

export interface MerlinSpaceGitHub {
  owner: string;
  repo: string;
  defaultBranch?: string;
}

export interface MerlinSpaceData {
  columns?: string[];
  rows?: string[][];
  intro?: string;
  sections?: MerlinSpaceSection[];
  listId?: string;
  goal?: string;
  milestones?: MerlinSpaceMilestone[];
  github?: MerlinSpaceGitHub;
  servings?: number;
  ingredients?: MerlinSpaceIngredient[];
  steps?: MerlinSpaceStep[];
}

export interface MerlinSpace {
  id: string;
  kind: MerlinSpaceKind;
  title: string;
  recap: string;
  data: MerlinSpaceData;
  status: 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
}

export interface AgentContext {
  days: Record<string, DayEntry>;
  facts: MerlinFact[];
  lists: MerlinList[];
  reminders: MerlinReminder[];
  customTools: MerlinCustomTool[];
  spaces: MerlinSpace[];
  activeSpaceId?: string | null;
  activeSpace?: MerlinSpace | null;
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

export type AgentSideEffect = 'list_updated' | 'reminder_created' | 'reminder_completed' | 'space_updated';

export interface AgentMutations {
  lists?: MerlinList[];
  reminders?: MerlinReminder[];
  facts?: MerlinFact[];
  customTools?: MerlinCustomTool[];
  spaces?: MerlinSpace[];
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
  githubToken?: string;
}

export interface AgentRequestBody {
  message: string;
  context: AgentContext;
  config?: AgentClientConfig;
  stream?: boolean;
  /** Lance le traitement en arrière-plan côté serveur (survit à la fermeture de l'app). */
  background?: boolean;
  jobId?: string;
}

export type AgentJobStatus = 'pending' | 'running' | 'done' | 'error';

export interface AgentJobRecord {
  status: AgentJobStatus;
  steps: AgentStep[];
  result?: AgentRunResult;
  error?: string;
  updatedAt: number;
}

export interface AgentJobStartResponse {
  jobId: string;
  status: AgentJobStatus;
}

export interface AgentJobPollResponse {
  jobId: string;
  status: AgentJobStatus;
  steps: AgentStep[];
  result?: AgentRunResult;
  error?: string;
}

export interface ToolResult {
  ok: boolean;
  content: string;
  mutation?: AgentSideEffect;
}
