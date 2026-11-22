import type { PluginInference, PluginModelSpec } from 'learnharness-plugin-api';
import { fields, text } from '../study/schema.ts';
import { StudyError, type StudyUnit } from '../study/types.ts';
import { JUDGE_SYSTEM, judgeRequest, SCAFFOLD_SYSTEM, scaffoldRequest, TASK_SYSTEM, taskRequest } from './prompts.ts';
import { failureType, fidelity, LIMITS } from './schema.ts';
import { CUE_COUNT, type ModelJudgment, type ModelRef, type PracticeTask, type TaskKind } from './types.ts';

export type GeneratedTask = Omit<PracticeTask, 'id' | 'revision' | 'createdAt' | 'unitId'>;

const INVALID_TASK = 'El modelo no devolvió una tarea válida';
const INVALID_JUDGMENT = 'El modelo no devolvió un contraste válido';

/** The strong slot: task quality matters more than cost here. */
export async function strongModel(inference: PluginInference, para = 'generar tareas'): Promise<PluginModelSpec> {
  const catalog = await inference.catalog();
  const pin = catalog.slots?.strong;
  if (!pin?.model) throw new StudyError('INVALID_INPUT', `Configura el modelo fuerte en Ajustes para ${para}.`);
  return { ...pin.model, ...(pin.thinkingLevel ? { thinkingLevel: pin.thinkingLevel } : {}) };
}

/** First balanced JSON object in the text, tolerating prose or code fences around it. */
export function firstJsonObject(raw: string): unknown {
  const start = raw.indexOf('{');
  if (start === -1) return undefined;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inString) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(raw.slice(start, i + 1)); } catch { return undefined; }
    }
  }
  return undefined;
}

async function ask(inference: PluginInference, model: PluginModelSpec, system: string, user: string, signal: AbortSignal, failure: string): Promise<unknown> {
  const message = await inference.complete({
    model, purpose: 'user', signal,
    context: { systemPrompt: system, messages: [{ role: 'user', content: user, timestamp: Date.now() }] },
  });
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    throw new StudyError('INVALID_INPUT', `${failure}: ${message.errorMessage ?? message.stopReason}`);
  }
  const raw = message.content.filter(block => block.type === 'text').map(block => (block as { text: string }).text).join('');
  const parsed = firstJsonObject(raw);
  if (parsed === undefined) throw new StudyError('INVALID_INPUT', failure);
  return parsed;
}

function modelRef(spec: PluginModelSpec): ModelRef {
  return { provider: spec.provider, id: spec.id };
}

export async function generateTask(inference: PluginInference, unit: StudyUnit, kind: TaskKind, previousPrompts: readonly string[], signal: AbortSignal, excerpt: string | null = null): Promise<GeneratedTask> {
  const model = await strongModel(inference);
  const value = await ask(inference, model, TASK_SYSTEM, taskRequest(unit, kind, previousPrompts, excerpt), signal, INVALID_TASK);
  try {
    const r = fields(value, ['prompt', 'cues', 'reference', 'rubric'], 'task');
    if (!Array.isArray(r.cues) || r.cues.length !== CUE_COUNT) throw new Error('cues');
    if (!Array.isArray(r.rubric) || r.rubric.length < 1 || r.rubric.length > 20) throw new Error('rubric');
    return {
      kind,
      prompt: text(r.prompt, LIMITS.prompt, 'prompt', { required: true }),
      cues: r.cues.map((c, i) => text(c, LIMITS.cue, `cues[${i}]`, { required: true })),
      reference: text(r.reference, LIMITS.reference, 'reference', { required: true }),
      rubric: r.rubric.map((c, i) => text(c, LIMITS.rubricItem, `rubric[${i}]`, { required: true })),
      model: modelRef(model),
    };
  } catch { throw new StudyError('INVALID_INPUT', INVALID_TASK); }
}

export async function judgeAttempt(inference: PluginInference, task: PracticeTask, answer: string, now: string, signal: AbortSignal, excerpt: string | null = null): Promise<ModelJudgment> {
  const model = await strongModel(inference);
  const value = await ask(inference, model, JUDGE_SYSTEM, judgeRequest(task, answer, excerpt), signal, INVALID_JUDGMENT);
  try {
    const r = fields(value, ['fidelity', 'failureType', 'rationale'], 'judgment');
    return {
      fidelity: fidelity(r.fidelity, 'fidelity'),
      failureType: failureType(r.failureType ?? null, 'failureType'),
      rationale: text(r.rationale ?? '', LIMITS.rationale, 'rationale'),
      judgedAt: now,
      model: modelRef(model),
    };
  } catch { throw new StudyError('INVALID_INPUT', INVALID_JUDGMENT); }
}

/** Cues and rubric for a question David wrote: his question and answer go into the task verbatim. */
export async function scaffoldOwnTask(inference: PluginInference, question: string, answer: string, signal: AbortSignal): Promise<GeneratedTask> {
  const model = await strongModel(inference);
  const value = await ask(inference, model, SCAFFOLD_SYSTEM, scaffoldRequest(question, answer), signal, INVALID_TASK);
  try {
    const r = fields(value, ['cues', 'rubric'], 'task');
    if (!Array.isArray(r.cues) || r.cues.length !== CUE_COUNT) throw new Error('cues');
    if (!Array.isArray(r.rubric) || r.rubric.length < 1 || r.rubric.length > 20) throw new Error('rubric');
    return {
      kind: 'guiada',
      prompt: text(question, LIMITS.prompt, 'prompt', { required: true }),
      cues: r.cues.map((c, i) => text(c, LIMITS.cue, `cues[${i}]`, { required: true })),
      reference: text(answer, LIMITS.reference, 'reference', { required: true }),
      rubric: r.rubric.map((c, i) => text(c, LIMITS.rubricItem, `rubric[${i}]`, { required: true })),
      model: modelRef(model),
    };
  } catch { throw new StudyError('INVALID_INPUT', INVALID_TASK); }
}
