import type { AgentClientConfig, AgentContext, AgentRunResult, AgentStep } from '../../lib/merlin-agent/types.js';
import { runMerlinAgentSegmented } from './runner-segment.js';

export type StepCallback = (step: AgentStep) => void;

export async function runMerlinAgent(
  userMessage: string,
  context: AgentContext,
  config: AgentClientConfig,
  options?: { onStep?: StepCallback; referer?: string },
): Promise<AgentRunResult> {
  return runMerlinAgentSegmented(
    { message: userMessage, context, config },
    options,
  );
}
