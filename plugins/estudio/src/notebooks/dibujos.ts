import { MAX_DIBUJO } from './types.ts';

/* The drawings of the tutor (ticket 12h), read from the very answer of the call that wrote the comment: the model writes a
 * sentence and, when it was asked to draw, one `<dibujo>` tag with Mermaid source. Nothing here renders anything and nothing
 * writes anywhere. The tag never reaches the visible text, even malformed or cut short, and the source is cleaned of what
 * could change how the app draws it (init directives) before it is stored. */

const ABRE = '<dibujo>', CIERRA = '</dibujo>';
const VALLA = /```[ \t]*(?:mermaid)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/gi;

/** The Mermaid source of a diagram as it will be stored, or null when there is nothing to draw or it is over the limit. Fences
 * around it and `%%{ ... }%%` directives (they can change theme and configuration) are removed; a long diagram is refused, not
 * cut, because a truncated one would not compile. */
export function limpiarMermaid(fuente: string): string | null {
  let s = fuente.trim();
  const valla = [...s.matchAll(VALLA)];
  if (valla.length > 0) s = valla[valla.length - 1]![1]!;
  // Until nothing changes: removing one directive can join the pieces of another (`%%%%{a}%%{init: ...}%%`).
  for (let antes = ''; antes !== s;) { antes = s; s = s.replace(/^---[\s\S]*?\n---\s*\n/, '').replace(/%%\{[\s\S]*?\}%%/g, '').trim(); }
  return s && s.length <= MAX_DIBUJO && !s.includes('%%{') ? s : null;
}

export interface DibujoLeido {
  /** The answer without the diagram, as David reads it. */
  texto: string;
  mermaid: string | null;
  /** Why a diagram that was there was not kept: cut short, or over the limit. */
  motivo?: 'incompleto' | 'grande';
}

/** The sentence and the diagram of an answer. The diagram comes from the last `<dibujo>` tag or, failing that, from the last
 * fenced mermaid block of the text, which models write on their own. */
export function separarDibujo(crudo: string): DibujoLeido {
  const desde = crudo.lastIndexOf(ABRE);
  if (desde !== -1) {
    const hasta = crudo.indexOf(CIERRA, desde);
    const antes = crudo.slice(0, desde), despues = hasta === -1 ? '' : crudo.slice(hasta + CIERRA.length);
    const texto = `${antes}${despues}`.trim();
    if (hasta === -1) return { texto, mermaid: null, motivo: 'incompleto' };
    const dentro = crudo.slice(desde + ABRE.length, hasta);
    const mermaid = limpiarMermaid(dentro);
    return mermaid ? { texto, mermaid } : { texto, mermaid: null, ...(dentro.trim() ? { motivo: 'grande' as const } : {}) };
  }
  const vallas = [...crudo.matchAll(VALLA)].filter(m => /^\s*(flowchart|graph|sequenceDiagram|stateDiagram|classDiagram|erDiagram|mindmap|timeline|journey|gantt|pie|gitGraph|quadrantChart|requirementDiagram|C4)\b/i.test(m[1]!) || /```\s*mermaid/i.test(m[0]));
  const ultima = vallas.at(-1);
  if (!ultima) return { texto: crudo.trim(), mermaid: null };
  const texto = `${crudo.slice(0, ultima.index)}${crudo.slice(ultima.index! + ultima[0].length)}`.trim();
  const mermaid = limpiarMermaid(ultima[1]!);
  return mermaid ? { texto, mermaid } : { texto, mermaid: null, ...(ultima[1]!.trim() ? { motivo: 'grande' as const } : {}) };
}
