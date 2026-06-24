import type {
  AgentClientConfig,
  AgentContext,
  AgentRunResult,
  AgentSideEffect,
  AgentStep,
  ChatMessage,
  WebSource,
} from './types.js';
import type { SerializedAgentStore } from '../../server/merlin-agent/tools.js';

export interface PlannerSnapshot {
  intent?: string;
  memoryQueries?: string[];
  suggestedTools?: string[];
  approach?: string;
}

export interface PendingToolCall {
  name: string;
  args: Record<string, string>;
  llmText: string;
}

/** Une étape async = un segment Vercel (LLM, outil web, synthèse…). */
export type AgentSegmentPhase =
  | 'bootstrap'
  | 'plan'
  | 'llm'
  | 'tool'
  | 'synthesize'
  | 'finalize';

export interface AgentJobCheckpoint {
  userMessage: string;
  context: AgentContext;
  config: AgentClientConfig;
  depth: 'standard' | 'deep';
  steps: AgentStep[];
  storeSnapshot: SerializedAgentStore;
  memoryBlock: string;
  planner: PlannerSnapshot | null;
  memoryQueries: string[];
  messages: ChatMessage[];
  iteration: number;
  maxIterations: number;
  lastSideEffect?: AgentSideEffect;
  toolResultsForSynthesis: string[];
  continueAfterTools: boolean;
  webSources: WebSource[];
  phase: AgentSegmentPhase;
  pendingTool?: PendingToolCall;
  pendingReply?: string;
  synthesizedReply?: string;
}

export type AgentAdvanceResult =
  | { status: 'done'; result: AgentRunResult }
  | { status: 'yield'; checkpoint: AgentJobCheckpoint }
  | { status: 'failed'; result: AgentRunResult };

export const MAX_AGENT_SEGMENTS = 48;
