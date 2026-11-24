import type { PluginLearningData } from 'learnharness-plugin-api';

export type ChatRecord = NonNullable<ReturnType<PluginLearningData['getSession']>>;
type Message = ChatRecord['messages'][number];

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
