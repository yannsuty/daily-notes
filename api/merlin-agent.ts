import type { VercelRequest, VercelResponse } from '@vercel/node';
import { MAX_AGENT_SEGMENTS } from '../lib/merlin-agent/agent-checkpoint.js';
import { JOB_STREAM_MAX_MS } from '../lib/merlin-agent/agent-duration.js';
import {
  appendAgentJobStep,
  createJobId,
  expireStaleRunningJob,
  failAgentJob,
  finishAgentJob,
  getAgentJob,
  saveAgentJob,
  saveAgentJobCheckpoint,
  touchAgentJob,
} from '../server/agent-jobs.js';
import {
  advanceAgentRun,
  createBootstrapCheckpoint,
} from '../server/merlin-agent/runner-segment.js';
import { scheduleBackground } from '../server/wait-until.js';
import {
  runMerlinAgent,
  type AgentRequestBody,
  type AgentRunResult,
  type AgentStep,
} from '../server/merlin-agent/index.js';

const JOB_HEARTBEAT_MS = 25_000;

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

function writeSse(res: VercelResponse, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const JOB_STREAM_POLL_MS = 400;

async function streamAgentJob(
  req: VercelRequest,
  res: VercelResponse,
  jobId: string,
  fromStep: number,
): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  const started = Date.now();
  let seen = fromStep;

  while (Date.now() - started < JOB_STREAM_MAX_MS) {
    if (req.socket?.destroyed) {
      return;
    }

    const job = await getAgentJob(jobId);
    if (!job) {
      writeSse(res, 'error', { error: 'Job not found' });
      res.end();
      return;
    }

    const current = await expireStaleRunningJob(jobId);
    if (!current) {
      writeSse(res, 'error', { error: 'Job not found' });
      res.end();
      return;
    }

    for (let i = seen; i < current.steps.length; i += 1) {
      writeSse(res, 'step', { step: current.steps[i] });
    }
    seen = current.steps.length;

    if (current.status === 'done' && current.result) {
      writeSse(res, 'done', { result: current.result });
      res.end();
      return;
    }

    if (current.status === 'error') {
      writeSse(res, 'error', {
        error: current.error ?? 'Erreur agent',
        steps: current.steps,
      });
      res.end();
      return;
    }

    await sleep(JOB_STREAM_POLL_MS);
  }

  writeSse(res, 'reconnect', { fromStep: seen });
  res.end();
}

async function processBackgroundJob(
  jobId: string,
  body: AgentRequestBody,
): Promise<void> {
  const heartbeat = setInterval(() => {
    void touchAgentJob(jobId);
  }, JOB_HEARTBEAT_MS);

  try {
    const job = await getAgentJob(jobId);
    if (!job) return;

    const segmentCount = job.segmentCount ?? 0;
    if (segmentCount >= MAX_AGENT_SEGMENTS) {
      await failAgentJob(
        jobId,
        'La réflexion a nécessité trop d\'étapes. Réessayez avec une demande plus ciblée.',
      );
      return;
    }

    if (job.status === 'pending') {
      await saveAgentJob(jobId, {
        ...job,
        status: 'running',
        updatedAt: Date.now(),
      });
    }

    const checkpoint = job.checkpoint ?? createBootstrapCheckpoint(body);

    const outcome = await advanceAgentRun(checkpoint, {
      referer: referer(),
      onStep: (step) => {
        void appendAgentJobStep(jobId, step);
      },
    });

    if (outcome.status === 'done') {
      const current = await getAgentJob(jobId);
      await finishAgentJob(jobId, {
        ...outcome.result,
        steps: current?.steps.length ? current.steps : outcome.result.steps,
      });
      return;
    }

    if (outcome.status === 'failed') {
      await failAgentJob(jobId, outcome.result.error ?? 'Agent error');
      return;
    }

    const current = await getAgentJob(jobId);
    await saveAgentJobCheckpoint(jobId, {
      status: 'running',
      steps: current?.steps ?? [],
      checkpoint: outcome.checkpoint,
      segmentCount: segmentCount + 1,
    });

    scheduleBackground(() => processBackgroundJob(jobId, body));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Agent error';
    await failAgentJob(jobId, message);
  } finally {
    clearInterval(heartbeat);
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

    const stream =
      req.query.stream === '1' ||
      req.query.stream === 'true' ||
      req.query.stream === 'sse';
    const fromStepRaw = req.query.fromStep;
    const fromStep =
      typeof fromStepRaw === 'string' && fromStepRaw
        ? Math.max(0, Number.parseInt(fromStepRaw, 10) || 0)
        : 0;

    try {
      if (stream) {
        await streamAgentJob(req, res, jobId, fromStep);
        return;
      }

      const job = await expireStaleRunningJob(jobId);
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
      if (stream) {
        writeSse(res, 'error', { error: message });
        return res.end();
      }
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
