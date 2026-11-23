/** Lo que el armazón lee de las operaciones `planes` y `unidad` del plugin Estudio
 * (`plugins/estudio/src/armazon.ts`); el núcleo no importa el código del plugin. */

export type EstadoGrupo = "hecho" | "pendiente" | "vacio";
export interface CicloUnidad { orientar: EstadoGrupo; exponer: EstadoGrupo; reconstruir: EstadoGrupo; mantener: EstadoGrupo }

export type TipoUnidad = "concepto" | "procedimiento" | "argumento" | "modelo";
export type PracticaUnidad = "recordar" | "reconstruir" | "ejecutar" | "localizar";
export type Tarea = "guiada" | "libre" | "estructural" | "aplicada" | "comparacion" | "transferencia";

export type TipoElemento = "tema" | "tarea" | "hito";
export type EstadoPlan = "propuesto" | "activo" | "archivado";
/** Un elemento de un plan; un tema que David decidió trabajar lleva su unidad. */
export interface ElementoPlan {
	id: string;
	tipo: TipoElemento;
	titulo: string;
	hecho: boolean;
	/** Solo en un hito con fecha: `AAAA-MM-DD`. */
	fecha: string | null;
	unidad: { id: string; titulo: string; estado: "propuesta" | "activa" | "archivada"; ciclo: CicloUnidad } | null;
}
/** Un cambio del plan que propuso el tutor; `caducado`: por qué ya no se puede aplicar, solo cabe descartarlo. */
export interface CambioPendiente { id: string; descripcion: string[]; motivo: string; caducado: string | null }
export interface PlanLeido {
	id: string;
	revision: number;
	objetivo: string;
	estado: EstadoPlan;
	origen: "tutor" | "manual";
	hechos: number;
	total: number;
	elementos: ElementoPlan[];
	cambios: CambioPendiente[];
}
export interface UnidadSinPlan { id: string; titulo: string; propuesta: boolean; ciclo: CicloUnidad }
/** Los planes vivos del espacio activo (propuestos y activos, el último actualizado primero) y las unidades sin plan. */
export interface LecturaPlanes { planes: PlanLeido[]; sinPlan: UnidadSinPlan[] }

export interface LecturaUnidad {
	id: string;
	revision: number;
	titulo: string;
	estado: "propuesta" | "activa" | "archivada";
	/** El espacio de la unidad, o null si no tiene. */
	areaId: string | null;
	/** El plan con un tema enlazado a la unidad, o null si no está en ninguno. */
	plan: { id: string; objetivo: string } | null;
	/** La capacidad y el criterio que sugirió el tutor, pendientes de aceptar o descartar. */
	sugerencia: { capacidad: string; criterio: string } | null;
	capacidad: string;
	criterio: string;
	tipo: TipoUnidad | null;
	practica: PracticaUnidad | null;
	practicaEfectiva: PracticaUnidad;
	etapa: { kind: string; label: string; days: number | null };
	ciclo: CicloUnidad;
	/** «Lo que sabía antes», escrito sin IA en esta página o al pedírselo el sondeador; null si aún no existe. */
	volcado: { texto: string; fecha: string; origen: "pagina" | "sondeo" } | null;
	/** Capturas y última captura salen de los hechos «fuente trabajada» (ADR 0004). */
	fuentes: { path: string; documentoId: string | null; titulo: string; paginas: number | null; localizador: string | null; capturas: number; ultimaCaptura: string | null; reconstruida: boolean }[];
	notas: { cuadernoId: string; cuaderno: string; id: string; simbolo: string | null; texto: string; cita: string; localizador: string }[];
	preguntas: { cuadernoId: string; cuaderno: string; id: string; pregunta: string }[];
	/** Los cuadernos vinculados a la unidad, aunque aún no tengan bloques; del editado más recientemente al más antiguo. */
	cuadernos: { id: string; titulo: string; tipo: "fuente" | "conocimiento" | "sintesis" | "libre"; notas: number; preguntas: number; actualizado: string }[];
	intentos: { id: string; fecha: string; tarea: Tarea; estado: "open" | "frozen" | "graded" | "abandoned"; fidelidad: number | null }[];
	proximoRepaso: string | null;
	/** Con lo que dejó su resumen; `resumenAntiguo` si es anterior a los últimos mensajes. */
	conversaciones: {
		id: string; title: string; updatedAt: string;
		resumen: { tema: string; abierto: string[]; siguiente: string } | null; resumenAntiguo: boolean; resumenError: string | null;
	}[];
	/** El paso propuesto de la unidad (ADR 0004), o null si no hay ninguno. */
	paso: Paso | null;
}

/** Qué hace un paso propuesto; el armazón decide a dónde lleva (`components/estudio/paso.ts`). */
export type TipoPaso = "decidir" | "volcado" | "reconstruir" | "repasar" | "tutor";
export interface Paso { tipo: TipoPaso; accion: string; motivo: string; boton: string }
export interface PasoDeUnidad extends Paso { unitId: string; titulo: string }

/** La lectura `inicio` (`plugins/estudio/src/inicio.ts`). */
export interface LecturaInicio {
	paso: PasoDeUnidad | null;
	pasos: PasoDeUnidad[];
	repasos: { unitId: string; titulo: string; tarea: Tarea; intentoId: string | null; fecha: string | null }[];
	proximos: { dia: string; unidades: { unitId: string; titulo: string; tarea: Tarea }[] }[];
	abierto: { chatId: string; titulo: string; fecha: string; abierto: string[]; siguiente: string } | null;
}

/** La lectura `por-decidir` (`plugins/estudio/src/inicio.ts`): planes, cambios de planes y sugerencias de capacidad
 * que propuso el tutor en el espacio activo, y borradores de conocimiento sin confirmar, que son de la base, común a
 * todos los espacios. */
export interface LecturaPorDecidir {
	planes: { id: string; revision: number; objetivo: string; elementos: number }[];
	/** `caducado`: por qué ya no se puede aplicar; solo cabe descartarlo. */
	cambios: { id: string; planId: string; objetivo: string; descripcion: string[]; motivo: string; caducado: string | null }[];
	sugerencias: { unitId: string; revision: number; titulo: string; capacidad: string; criterio: string }[];
	borradores: { id: string; tipo: "hecho" | "pregunta" | "sintesis"; resumen: string; origen: "david" | "tutor"; registros: number }[];
}

/** La lectura `agenda` (`plugins/estudio/src/agenda.ts`): por día con algo, lo pendiente y lo hecho del espacio. */
export type PendienteAgenda =
	| { tipo: "repaso"; unitId: string; titulo: string; tarea: Tarea; intentoId: string | null; fecha: string | null; vencidoDias: number }
	| { tipo: "paso"; unitId: string; titulo: string; paso: PasoDeUnidad };
export type HechoAgenda =
	| { tipo: "intento"; unitId: string; titulo: string; tarea: Tarea; intentoId: string }
	| { tipo: "volcado" | "fuente-trabajada" | "cierre-bloque"; unitId: string; titulo: string }
	| { tipo: "conversacion"; chatId: string; titulo: string; unitId: string | null };
export interface DiaAgenda { dia: string; pendientes: PendienteAgenda[]; hecho: HechoAgenda[] }
export interface LecturaAgenda { hoy: string; desde: string; hasta: string; dias: DiaAgenda[] }

/** La lectura `ritmo` (`plugins/estudio/src/ritmo.ts`), del espacio activo; día estudiado es el de la agenda. */
export interface LecturaRitmo {
	hoy: string;
	/** Días estudiados en las últimas 4 semanas, hoy incluido. */
	diasEstudiados: number;
	/** Días estudiados seguidos hasta hoy, o hasta ayer si hoy aún no. */
	racha: number;
	/** Repasos de las últimas 4 semanas y los hechos en su fecha o antes. */
	repasos: { total: number; aTiempo: number };
	/** Intentos valorados por semana, de la más antigua a la que acaba hoy. */
	intentosPorSemana: number[];
	tendencia: "sube" | "baja" | "igual";
	/** Cuánto se hizo cada día, del más antiguo a hoy (365 días). */
	actividad: { dia: string; n: number }[];
}

export type TipoFallo = "acceso" | "precision" | "estructural" | "discriminacion" | "aplicacion" | "transferencia";

/** Un intento como lo devuelven `intento`, `empezar`, `pista` y `autoevaluar`
 * (`plugins/estudio/src/practice/attempts.ts`): antes de congelar no trae
 * referencia ni rúbrica, y solo las pistas pedidas. */
export interface IntentoPublico {
	attempt: {
		id: string;
		unitId: string;
		taskKind: Tarea;
		status: "open" | "frozen" | "graded" | "abandoned";
		confidence: number;
		/** 0 a 5 pistas; 6 = fuente abierta, cuenta como no recuperado. */
		cueLevel: number;
		answer: string;
		judgments: { fidelity: number; failureType: TipoFallo | null; rationale: string }[];
		grades: { fidelity: number; use: number | null; failureType: TipoFallo | null }[];
	};
	prompt: string;
	cues: string[];
	reference: string | null;
	rubric: string[] | null;
}

/** La lectura `intento`: el intento y el título de su unidad. */
export interface LecturaIntento extends IntentoPublico { titulo: string }

/** Etapas del regulador (`plugins/estudio/src/practice/stage.ts`): describen la evidencia, no son un veredicto. */
export type TipoEtapa = "nueva" | "practicada" | "reaprendiendo" | "intervalo" | "mantenimiento" | "fuera";

/** La lectura `progreso` (`progress` en `plugins/estudio/src/practice/service.ts`), filtrada por el espacio activo.
 * De cada unidad solo se usa lo que tiene sentido en conjunto; su historial vive en su página. */
export interface LecturaProgreso {
	units: { unitId: string; title: string; stage: { kind: TipoEtapa; label: string; days: number | null }; needsVerification: boolean }[];
	/** Confianza declarada antes de los intentos que cuentan como evidencia frente a recuperar completo y sin ayuda. */
	calibration: { attempts: number; brier: number; meanConfidence: number; successRate: number } | null;
	failures: Partial<Record<TipoFallo, number>>;
}
