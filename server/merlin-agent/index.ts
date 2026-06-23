export type {
  AgentClientConfig,
  AgentContext,
  AgentMutations,
  AgentRequestBody,
  AgentRunResult,
  AgentSideEffect,
  AgentStep,
  AgentStepPhase,
  QueryDepth,
} from '../../lib/merlin-agent/types.js';

export { runMerlinAgent, type StepCallback } from './runner.js';
