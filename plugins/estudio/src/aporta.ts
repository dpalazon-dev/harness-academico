/* Lo que Estudio aporta al tutor, explicado en español para Ajustes: las instrucciones que añade a los prompts (en
 * inglés, como todo prompt) y las herramientas que le da. Cada instrucción corresponde a un `registerInstructions` de
 * backend.ts, en el mismo orden; las pruebas lo fijan para que el catálogo no se desvíe del código. */

export type AgenteDeEstudio = 'prober' | 'teacher';

export interface InstruccionAportada {
  id: string;
  nombre: string;
  proposito: string;
  agentes: AgenteDeEstudio[];
}

export interface HerramientaAportada {
  nombre: string;
  descripcion: string;
}

export interface Aportacion {
  instrucciones: InstruccionAportada[];
  herramientas: HerramientaAportada[];
}

export const INSTRUCCIONES: readonly InstruccionAportada[] = [
  {
    id: 'plan-y-conocimiento',
    nombre: 'Plan de estudio y base de conocimiento',
    proposito: 'Lee tu plan al empezar, propone unidades y cambios sin aplicarlos, y busca en tus fuentes, cuadernos y conversaciones antes de explicar.',
    agentes: ['prober', 'teacher'],
  },
  {
    id: 'arranque-y-sondeo',
    nombre: 'Arranque y encuadre',
    proposito: 'Quién produce y quién critica; en una conversación libre, charla escueta hasta que pidas empezar; luego pregunta qué quieres hacer y cuánto tiempo tienes, y pide tu versión de lo que ya sabes.',
    agentes: ['prober'],
  },
  {
    id: 'cierre-de-bloque',
    nombre: 'Enseñanza y cierre de bloque',
    proposito: 'Quién produce y quién critica; al terminar un bloque del plan, tú lo reconstruyes, el tutor contrasta, tú reparas y se registra el cierre.',
    agentes: ['teacher'],
  },
  {
    id: 'resumen-de-arranque',
    nombre: 'Dónde lo dejaste',
    proposito: 'Al empezar cada conversación, un resumen de tu plan, lo pendiente de repasar y las conversaciones anteriores.',
    agentes: ['prober', 'teacher'],
  },
];

/** La frase en español de cada herramienta, por su nombre. */
export const HERRAMIENTAS: Readonly<Record<string, string>> = {
  estudio_buscar: 'Busca en lo que ya confirmaste, en el texto de tus fuentes (con página), en conversaciones anteriores y en tus cuadernos.',
  estudio_proponer_hecho: 'Propone una afirmación de una fuente con su cita literal y su página; espera a que la confirmes.',
  estudio_estado: 'Lee tu plan de estudio: objetivo, unidades y propuestas pendientes.',
  estudio_proponer_unidad: 'Propone una unidad de estudio nueva; espera a que la confirmes.',
  estudio_proponer_plan: 'Propone añadir, quitar o reordenar unidades del plan; nada cambia hasta que lo apliques.',
  estudio_cerrar_bloque: 'Registra en una unidad el cierre de un bloque de trabajo.',
};

/** Lo que Estudio aporta, con las herramientas que de verdad crea; una sin frase muestra su descripción original. */
export function aportacion(herramientas: readonly { name: string; description: string }[]): Aportacion {
  return {
    instrucciones: INSTRUCCIONES.map(i => ({ ...i, agentes: [...i.agentes] })),
    herramientas: herramientas.map(h => ({ nombre: h.name, descripcion: HERRAMIENTAS[h.name] ?? h.description })),
  };
}
