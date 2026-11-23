/** Nombre y propósito en español de cada fragmento de instrucciones del núcleo (`src/agent/prompts`), para Ajustes.
 * El texto que recibe el modelo sigue en inglés; esto solo lo explica. Un fragmento nuevo sin entrada se muestra con su
 * ruta y sin propósito: la prueba `tests/instrucciones-sistema.test.ts` exige que todos los del núcleo tengan una. */

export interface FichaInstruccion {
	nombre: string;
	proposito: string;
}

export const FICHAS_INSTRUCCIONES: Readonly<Record<string, FichaInstruccion>> = {
	"system-prompt.md": { nombre: "Base del tutor", proposito: "Para qué existe el tutor: comprensión, no datos memorizados; medir lo que sabes, planificar y enseñar justo en el borde de lo que entiendes." },
	"prober/10-probe-doctrine.md": { nombre: "Cómo sondea", proposito: "Concreta tu objetivo y acota con preguntas, una a una, lo que ya sabes de cada hilo del tema antes de planificar." },
	"teacher/05-method.md": { nombre: "Método", proposito: "Dos principios: primero las verdades incondicionales; y explicar cada idea como algo que podrías haber descubierto." },
	"teacher/10-planning.md": { nombre: "Planificación", proposito: "Cómo construye y presenta el mapa del plan, y cómo lo ajusta a lo que vas mostrando." },
	"teacher/20-teaching.md": { nombre: "Enseñanza paso a paso", proposito: "Un paso cada vez, socrático o expositivo según el paso, y a tu ritmo." },
	"teacher/28-predictions.md": { nombre: "Predecir y comprobar", proposito: "El ciclo de cada paso: una pregunta para que predigas antes de ver y otra para comprobar lo entendido." },
	"teacher/30-question-principles.md": { nombre: "Principios de las preguntas", proposito: "Qué debe cumplir una pregunta de comprobación durante la enseñanza." },
	"teacher/40-jobs.md": { nombre: "Investigación y archivos", proposito: "Encarga verificaciones en la web en segundo plano y lee tus archivos de fuentes." },
	"teacher/50-demos.md": { nombre: "Demos y figuras", proposito: "Construye demos interactivas y figuras precisas en vez de describirlas." },
	"teacher/55-images.md": { nombre: "Tus imágenes", proposito: "Muestra y anota sobre las imágenes que aportas." },
	"practice/00-base.md": { nombre: "Base de la práctica", proposito: "Para qué existe la práctica: que lo que ya sabes salga y funcione; empieza directamente con problemas." },
	"practice/10-doctrine.md": { nombre: "Cómo practica", proposito: "Plantea problemas en tres modos, según lo que entrena cada uno, y cómo los acompaña y cierra." },
	"shared/10-voice.md": { nombre: "Voz", proposito: "Sin elogios ni entusiasmo fingido; los errores se nombran claramente." },
	"shared/15-accuracy.md": { nombre: "Exactitud", proposito: "Nada dudoso se enseña como cierto, sobre todo una interpretación: lo comprueba antes." },
	"shared/16-mental-model.md": { nombre: "Tus campos de pensamiento", proposito: "Lee lo que piensas en voz alta para modelar cómo entiendes, no solo si aciertas." },
	"shared/20-question-tools.md": { nombre: "Herramientas de pregunta", proposito: "Cómo construir preguntas evaluadas y preguntas abiertas, una por turno." },
	"shared/25-confidence.md": { nombre: "Confianza", proposito: "Cómo interpretar la seguridad que declaras en cada respuesta." },
	"shared/30-learner-files.md": { nombre: "Tus archivos", proposito: "Encuentra y lee tus archivos por su ruta o descripción; nunca te pide que pegues su contenido." },
	"shared/35-side-conversations.md": { nombre: "Preguntas al margen", proposito: "Cómo leer lo que hablaste con el ayudante de las preguntas al margen." },
	"shared/40-formatting.md": { nombre: "Formato", proposito: "Escribe como documentos en Markdown, con LaTeX para las fórmulas, no como mensajes de chat." },
};

/** La ficha de un fragmento, o su ruta como nombre si no tiene. */
export function fichaInstruccion(path: string): FichaInstruccion {
	return FICHAS_INSTRUCCIONES[path] ?? { nombre: path, proposito: "" };
}

/** Por qué el interruptor de una instrucción puede estar gris. */
export const AYUDA_INSTRUCCIONES = "Cada agente recibe estas instrucciones, en inglés, en este orden. Puedes leer el original y escribir tu versión; el interruptor se activa cuando guardas tu versión y decide cuál se usa.";

/** Un eslabón de la cadena de instrucciones de un agente, tal como la recibe. */
export interface PasoCadena {
	nombre: string;
	deEstudio: boolean;
}

/** Las instrucciones de un agente en el orden en que las recibe: las del núcleo y, detrás, las que añade Estudio. */
export function cadenaDeAgente(
	rutas: readonly string[],
	estudio: readonly { nombre: string; agentes: readonly string[] }[],
	agente: "teacher" | "prober" | "practice",
): PasoCadena[] {
	return [
		...rutas.map((ruta) => ({ nombre: fichaInstruccion(ruta).nombre, deEstudio: false })),
		...estudio.filter((i) => i.agentes.includes(agente)).map((i) => ({ nombre: i.nombre, deEstudio: true })),
	];
}
