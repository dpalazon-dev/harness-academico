import type { ChatRecord } from '../probe.ts';
import { nombreEstudiante } from '../identidad.ts';

type Message = ChatRecord['messages'][number];

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && (b as { type?: unknown }).type === 'text').map(b => String((b as { text?: unknown }).text ?? '')).join('\n');
};

/** What David and the tutor said, in order; tool traffic, thinking and failed turns are left out. */
export function transcriptText(record: ChatRecord): string {
  const lines: string[] = [];
  for (const message of record.messages as Message[]) {
    if (message.role === 'user') {
      const t = textOf(message.content).trim();
      if (t) lines.push(`${nombreEstudiante()}: ${t}`);
    } else if (message.role === 'assistant') {
      if (message.stopReason === 'error' || message.stopReason === 'aborted') continue;
      const t = textOf(message.content).trim();
      if (t) lines.push(`Tutor: ${t}`);
    }
  }
  return lines.join('\n\n');
}

/** The beginning and, above all, the end of a long transcript, where what stayed open is said. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.15);
  return `${text.slice(0, head)}\n\n[… ${text.length - max} caracteres omitidos …]\n\n${text.slice(text.length - (max - head))}`;
}

/** Everything the study tools sent and received in this conversation, as one text to look IDs up in. */
export function toolTraffic(record: ChatRecord): string {
  const parts: string[] = [];
  for (const message of record.messages as Message[]) {
    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type === 'toolCall' && block.name.startsWith('estudio_')) parts.push(JSON.stringify(block.arguments ?? null));
      }
    } else if (message.role === 'toolResult' && message.toolName.startsWith('estudio_')) {
      parts.push(textOf(message.content), JSON.stringify(message.details ?? null));
    }
  }
  return parts.join('\n');
}
