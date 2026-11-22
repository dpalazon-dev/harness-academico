import type { PluginInference, PluginModelSpec } from 'learnharness-plugin-api';
import { firstJsonObject } from '../practice/model.ts';
import { clip } from './transcript.ts';
import { parseSummary, type ConversationSummary } from './types.ts';
import { nombreEstudiante } from '../identidad.ts';

/** Characters of transcript sent to the model; the end is kept, the middle is dropped first. */
export const TRANSCRIPT_MAX = 40000;

export const SUMMARY_SYSTEM = `You summarize one study conversation between a learner (${nombreEstudiante()}) and his tutor, so that the next conversation can pick up where this one ended.

Reply with one JSON object and nothing else:
{"tema": string, "trabajado": string[], "claro": string[], "abierto": string[], "siguiente": string}

- tema: what the conversation was about, one line.
- trabajado: what was explained, practised or discussed.
- claro: what David showed he understands or can do in this conversation. Within one conversation this is practice, not durable learning: state it as observed, never as mastered.
- abierto: doubts, errors, questions or tasks that were left unresolved.
- siguiente: the most useful next step, or "" if none was apparent.

Write in Spanish. Be concrete and brief: at most 6 items per list, each a short sentence. Only include what the transcript shows; do not invent.`;

/** The cheap slot, or null: summaries never fall back silently to the strong model. */
export async function cheapModel(inference: PluginInference): Promise<PluginModelSpec | null> {
  const catalog = await inference.catalog();
  const pin = catalog.slots?.cheap;
  if (!pin?.model) return null;
  return { ...pin.model, ...(pin.thinkingLevel ? { thinkingLevel: pin.thinkingLevel } : {}) };
}

export async function summarizeTranscript(inference: PluginInference, model: PluginModelSpec, title: string, transcript: string, signal: AbortSignal): Promise<ConversationSummary> {
  const message = await inference.complete({
    model, purpose: 'background', signal,
    context: { systemPrompt: SUMMARY_SYSTEM, messages: [{ role: 'user', content: `Conversation «${title}»:\n\n${clip(transcript, TRANSCRIPT_MAX)}`, timestamp: Date.now() }] },
  });
  if (message.stopReason === 'error' || message.stopReason === 'aborted') throw new Error(`El modelo no resumió la conversación: ${message.errorMessage ?? message.stopReason}`);
  const raw = message.content.filter(block => block.type === 'text').map(block => (block as { text: string }).text).join('');
  try { return parseSummary(firstJsonObject(raw)); }
  catch { throw new Error('El modelo no devolvió un resumen válido'); }
}
