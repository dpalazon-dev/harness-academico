/** KBOL records as kbol/schema.py accepts them in proposal mode: exactly these fields, nothing else. */
export interface KbSource {
  id: string;
  resource: string;
  representacion_id?: string;
  hash?: string;
  ancla?: string;
  contexto?: string;
}

interface Common {
  id: string;
  clase: 'registro';
  title: string;
  description: string;
  ambito: string;
  autor: string;
  eventos: [];
  sources: KbSource[];
}

export interface Evaluation { metodo: string; resultado: 'conforme' | 'parcial' | 'no_conforme'; limites: string }

export interface KbFuenteOriginal extends Common {
  type: 'fuente';
  estado: 'registrada';
  subtipo: 'original';
  origen: string;
  ubicacion: string;
  formato: string;
  sha256: string;
  acceso: string;
}

export interface KbFuenteDerivada extends Common {
  type: 'fuente';
  estado: 'registrada';
  subtipo: 'derivada';
  ubicacion: string;
  formato: string;
  sha256: string;
  acceso: string;
  derivada_de: string[];
  procesador: string;
  version_procesador: string;
  configuracion_ref: string;
  procesado_en: string;
  procesamiento: 'procesado';
  calidad: Record<string, Evaluation | 'no_evaluado'>;
}

export interface KbHecho extends Common {
  type: 'hecho';
  estado: 'propuesta';
  afirmacion: string;
  clase_evidencia: 'declarado' | 'observado' | 'calculado' | 'modelado' | 'predicho' | 'supuesto';
  precision: 'instante' | 'dia' | 'mes' | 'anio';
  fecha: string;
  basada_en: string[];
  afecta_a?: string[];
}

export interface KbEntidad extends Common {
  type: 'entidad';
  estado: 'propuesta';
  nombre: string;
  alias: string[];
  clase_entidad: string;
}

export interface KbPregunta extends Common {
  type: 'pregunta';
  estado: 'abierta';
  subtipo: 'incognita' | 'discrepancia';
  responsable: string;
  condicion_cierre: string;
  basada_en?: string[];
  afecta_a?: string[];
}

export interface KbSintesis extends Common {
  type: 'sintesis';
  estado: 'borrador';
  dependencias: string[];
  evaluaciones: Evaluation[];
}

export interface KbPersona extends Common {
  type: 'persona';
  estado: 'propuesta';
  naturaleza: 'humana';
  identidad_ref: string;
  ocupa: { rol: string; desde: string }[];
}

export interface KbRol extends Common {
  type: 'rol';
  estado: 'propuesta';
  ambitos: string[];
  capacidades: string[];
  regla_aprobacion: 'uno';
}

export type KbFuente = KbFuenteOriginal | KbFuenteDerivada;
export type KbRecord = KbFuente | KbHecho | KbEntidad | KbPregunta | KbSintesis | KbPersona | KbRol;

export const ENTITY_CLASSES = ['tarea', 'metodo', 'dataset', 'metrica', 'concepto', 'familia_modelo'] as const;
export type EntityClass = typeof ENTITY_CLASSES[number];

export const PREFIX: Record<KbRecord['type'], string> = {
  fuente: 'F', hecho: 'HE', entidad: 'ENT', pregunta: 'Q', sintesis: 'SIN', persona: 'PER', rol: 'ROL',
};

export const FOLDER: Record<KbRecord['type'], string> = {
  fuente: 'fuentes', hecho: 'hechos', entidad: 'entidades', pregunta: 'preguntas', sintesis: 'sintesis', persona: 'personas', rol: 'personas',
};
