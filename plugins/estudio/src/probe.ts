import { createHash } from 'node:crypto';
import type { PluginLearningData } from 'learnharness-plugin-api';
import type { StudyStore } from './study/store.ts';
import type { StudyUnit } from './study/types.ts';

export type ChatRecord = NonNullable<ReturnType<PluginLearningData['getSession']>>;
type Message = ChatRecord['messages'][number];

export interface ProbeStrand { strand: string; assessment: string }
export interface ProbeResult { chatId: string; toolCallId: string; strands: ProbeStrand[]; summary?: string }

function strandsOf(args: unknown): { strands: ProbeStrand[]; summary?: string } | null {
  const assessment = (args as { assessment?: unknown } | null)?.assessment as { strands?: unknown; summary?: unknown } | undefined;
  if (!assessment || !Array.isArray(assessment.strands)) return null;
  const strands = assessment.strands.filter((s): s is ProbeStrand =>
    !!s && typeof (s as ProbeStrand).strand === 'string' && (s as ProbeStrand).strand.trim() !== '' && typeof (s as ProbeStrand).assessment === 'string');
  if (strands.length === 0) return null;
  return typeof assessment.summary === 'string' ? { strands, summary: assessment.summary } : { strands };
}

/** Concluded probes only: same rule as the host's probeDoneResultIds (src/core/native-messages.ts),
 * reimplemented because plugins may not import host modules at runtime. */
export function extractProbeResults(record: ChatRecord): ProbeResult[] {
  const calls = new Map<string, unknown>();
  const results: ProbeResult[] = [];
  for (const message of record.messages as Message[]) {
    if (message.role === 'assistant') {
      if (message.stopReason === 'error' || message.stopReason === 'aborted') continue;
      for (const block of message.content) if (block.type === 'toolCall' && block.name === 'probe_done') calls.set(block.id, block.arguments);
    } else if (message.role === 'toolResult' && message.toolName === 'probe_done' && calls.has(message.toolCallId) && !message.isError &&
      (message.details as { ok?: unknown } | null | undefined)?.ok !== false) {
      const parsed = strandsOf(calls.get(message.toolCallId));
      if (parsed) results.push({ chatId: record.id, toolCallId: message.toolCallId, ...parsed });
    }
  }
  return results;
}

/** Deterministic and collision-resistant: a hash of the full chat and call ids, never a truncation. */
function unitId(chatId: string, toolCallId: string, index: number): string {
  const digest = createHash('sha256').update(JSON.stringify([chatId, toolCallId])).digest('hex').slice(0, 32);
  return `sondeo-${digest}-${index}`;
}

/** Each strand becomes a proposed unit; the deterministic id makes repeated ingestion a no-op. */
export function ingestProbeResults(store: StudyStore, results: readonly ProbeResult[], now: string, areaOf: (chatId: string) => string | null = () => null): StudyUnit[] {
  const created: StudyUnit[] = [];
  for (const result of results) {
    for (const [index, { strand, assessment }] of result.strands.entries()) {
      const id = unitId(result.chatId, result.toolCallId, index);
      if (store.getUnit(id)) continue;
      created.push(store.saveUnit({
        id, revision: 1, createdAt: now, updatedAt: now, status: 'propuesta',
        title: strand.trim().slice(0, 500), capability: '', criterion: '', kind: null, policy: null,
        graphNodeIds: [], sources: [], checkIds: [],
        origin: { kind: 'sondeo', chatId: result.chatId, toolCallId: result.toolCallId, strand: strand.slice(0, 500) },
        notes: assessment.slice(0, 20000), areaId: areaOf(result.chatId),
      }, null));
    }
  }
  return created;
}

/** El volcado que pidió el sondeador (spec, historia 27): en una conversación abierta desde una unidad, la primera
 * respuesta libre de David a ask_user_question antes de concluir el sondeo. El contexto de esa conversación pide el
 * volcado como primera pregunta cuando la unidad no lo tiene; si David la salta o elige una opción, no hay volcado. */
export function extractProbeDump(record: ChatRecord): { unitId: string; texto: string } | null {
  const first = record.messages[0] as { role?: string; customType?: string; details?: { tipo?: unknown; unidadId?: unknown } } | undefined;
  if (first?.role !== 'custom' || first.customType !== 'study-context' || first.details?.tipo !== 'unidad' || typeof first.details.unidadId !== 'string') return null;
  const unitId = first.details.unidadId;
  const asked = new Set<string>();
  for (const message of record.messages as Message[]) {
    if (message.role === 'assistant') {
      if (message.stopReason === 'error' || message.stopReason === 'aborted') continue;
      for (const block of message.content) if (block.type === 'toolCall' && block.name === 'ask_user_question') asked.add(block.id);
    } else if (message.role === 'toolResult' && !message.isError) {
      if (message.toolName === 'probe_done' && (message.details as { ok?: unknown } | null | undefined)?.ok !== false) return null;
      if (message.toolName !== 'ask_user_question' || !asked.has(message.toolCallId)) continue;
      // Libre sin opciones llega en `text`; con opciones, lo que escribe en «Otra» llega en `other`.
      const answer = message.details as { text?: unknown; other?: unknown; dismissed?: unknown } | null | undefined;
      const texto = answer?.dismissed === true ? '' : [answer?.text, answer?.other].find((x): x is string => typeof x === 'string' && x.trim() !== '')?.trim() ?? '';
      // Solo cuenta la primera pregunta: si la saltó, otra respuesta posterior no es su volcado.
      return texto ? { unitId, texto } : null;
    }
  }
  return null;
}
