import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  appendAgentJobStep,
  createJobId,
  failAgentJob,
  finishAgentJob,
  getAgentJob,
  saveAgentJob,
} from './lib/agent-jobs.js';
import {
  runMerlinAgent,
  type AgentRequestBody,
  type AgentRunResult,
  type AgentStep,
} from './lib/merlin-agent/index.js';
import { scheduleBackground } from './lib/wait-until.js';

function cors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function referer(): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:5173';
}

function writeNdjson(res: VercelResponse, payload: unknown): void {
  res.write(`${JSON.stringify(payload)}\n`);
}

async function processBackgroundJob(
  jobId: string,
  body: AgentRequestBody,
): Promise<void> {
  try {
    await saveAgentJob(jobId, {
      status: 'running',
      steps: [],
      updatedAt: Date.now(),
    });

    const result = await runMerlinAgent(body.message, body.context, body.config ?? {}, {
      referer: referer(),
      onStep: (step) => {
        void appendAgentJobStep(jobId, step);
      },
    });

    await finishAgentJob(jobId, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Agent error';
    await failAgentJob(jobId, message);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    const jobId = req.query.jobId;
    if (typeof jobId !== 'string' || !jobId) {
      return res.status(400).json({ error: 'Missing jobId' });
    }

    try {
      const job = await getAgentJob(jobId);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      return res.status(200).json({
        jobId,
        status: job.status,
        steps: job.steps,
        result: job.result,
        error: job.error,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Job lookup failed';
      return res.status(500).json({ error: message, retryable: true });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as AgentRequestBody;
  if (!body?.message?.trim() || !body.context) {
    return res.status(400).json({ error: 'Missing message or context', retryable: false });
  }

  if (body.background) {
    const jobId = body.jobId?.trim() || createJobId();
    await saveAgentJob(jobId, {
      status: 'pending',
      steps: [],
      updatedAt: Date.now(),
    });

    scheduleBackground(() => processBackgroundJob(jobId, body));

    return res.status(202).json({ jobId, status: 'pending' });
  }

  const stream = body.stream === true;
  const config = body.config ?? {};

  if (stream) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
  }

  const onStep = stream
    ? (step: AgentStep) => {
        writeNdjson(res, { type: 'step', step });
      }
    : undefined;

  try {
    const result: AgentRunResult = await runMerlinAgent(body.message, body.context, config, {
      onStep,
      referer: referer(),
    });

    if (stream) {
      writeNdjson(res, { type: 'done', result });
      return res.end();
    }

    return res.status(result.ok ? 200 : 503).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Agent error';
    if (stream) {
      writeNdjson(res, { type: 'error', error: message });
      return res.end();
    }
    return res.status(500).json({ ok: false, error: message, steps: [], mutations: {} });
  }
}
