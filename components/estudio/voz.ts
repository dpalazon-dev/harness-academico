/**
 * La voz del cuaderno (ticket 12j): leer en voz alta lo que escribe el tutor con la síntesis de voz del navegador
 * (`speechSynthesis`), que en la aplicación de escritorio usa las voces de Windows. Todo ocurre en el cliente: no se instala
 * nada, no hay servicio externo y el texto no sale del equipo. Por eso solo se eligen voces locales (`localService`): una voz
 * de red, si el navegador la ofreciera, enviaría el texto fuera.
 *
 * La interfaz es mínima: `limpiarParaVoz` (lo que se dice), `elegirVoz` (con qué voz), `estadoVoz`, `hablar` y `parar`. Solo
 * suena una lectura a la vez: una nueva sustituye a la anterior.
 */

export type EstadoVoz = "sin-soporte" | "espanol" | "sin-espanol";

/** Cuánto se espera a que el navegador cargue sus voces (`voiceschanged`) antes de hablar con la predeterminada. */
const ESPERA_VOCES_MS = 1500;

/** Lo que se dice de un texto del tutor: sin Markdown, sin diagramas, sin el bloque de propuestas, con una pausa por renglón. */
export function limpiarParaVoz(texto: string): string {
	let t = texto.replace(/\r\n?/g, "\n");
	// Las propuestas van en una etiqueta con JSON; una respuesta cortada puede dejarla sin cerrar.
	t = t.replace(/<propuestas>[\s\S]*?(<\/propuestas>|$)/gi, "");
	// Bloques de código y diagramas (también el que quedó sin cerrar): no se leen.
	t = t.replace(/```[\s\S]*?(```|$)/g, "\n");
	const renglones: string[] = [];
	for (const crudo of t.split("\n")) {
		let r = crudo.trim();
		if (!r || /^[-*_=\s|:]{3,}$/.test(r)) continue;
		r = r.replace(/^#{1,6}\s+/, "").replace(/^>+\s?/, "").replace(/^([-*+]|\d{1,2}[.)])\s+/, "");
		r = r.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
		r = r.replace(/<\/?[a-zA-Z][^>\n]*>/g, "");
		r = r.replace(/https?:\/\/\S+/g, "");
		r = r.replace(/`([^`]*)`/g, "$1");
		r = r.replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2");
		r = r.replace(/(^|[^\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])/g, "$1$2");
		r = r.replace(/(^|[^\w])_(?=\S)(.+?)(?<=\S)_(?![\w])/g, "$1$2");
		r = r.replace(/~~(.+?)~~/g, "$1");
		if (r.includes("|")) r = r.split("|").map(c => c.trim()).filter(Boolean).join(" ");
		r = r.replace(/\s+/g, " ").trim();
		if (!r) continue;
		renglones.push(/[.!?:;…,)»"”]$/.test(r) ? r : `${r}.`);
	}
	return renglones.join(" ");
}

const esEspanol = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-").startsWith("es");
const esEsES = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-") === "es-es";

/** La voz española local que se usará: es-ES si la hay, si no cualquier español; `null` si no hay ninguna. */
export function elegirVoz(voces: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
	const locales = voces.filter(v => v.localService);
	return locales.find(esEsES) ?? locales.find(esEspanol) ?? null;
}

const sintesis = (): SpeechSynthesis | null => {
	const s = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
	return s && typeof (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance === "function" ? s : null;
};

/** ¿Este equipo ofrece síntesis de voz? */
export const vozDisponible = (): boolean => sintesis() !== null;

/** Chromium carga las voces de forma asíncrona: `getVoices()` puede venir vacío hasta `voiceschanged`. */
function cargarVoces(synth: SpeechSynthesis): Promise<readonly SpeechSynthesisVoice[]> {
	const ya = synth.getVoices();
	if (ya.length) return Promise.resolve(ya);
	return new Promise(resolver => {
		const terminar = () => { clearTimeout(plazo); synth.removeEventListener("voiceschanged", alCambiar); resolver(synth.getVoices()); };
		const alCambiar = () => { if (synth.getVoices().length) terminar(); };
		const plazo = setTimeout(terminar, ESPERA_VOCES_MS);
		synth.addEventListener("voiceschanged", alCambiar);
	});
}

/** Si hay voz y si alguna es española (esperando a que carguen). */
export async function estadoVoz(): Promise<EstadoVoz> {
	const synth = sintesis();
	if (!synth) return "sin-soporte";
	return elegirVoz(await cargarVoces(synth)) ? "espanol" : "sin-espanol";
}

/** La lectura en curso: `fin` avisa una sola vez, aunque el motor dispare varios eventos o ninguno. */
let actual: { fin(fallo: boolean): void } | null = null;

/** Corta la lectura en curso, si la hay. */
export function parar(): void {
	const anterior = actual;
	actual = null;
	anterior?.fin(false);
	// Una lectura que aún espera las voces no llega a hablar (se descarta con `actual`); el motor, si habla, calla.
	sintesis()?.cancel();
}

/**
 * Lee `texto` en voz alta, sustituyendo a la lectura anterior. `alTerminar(fallo)` se llama una vez: al acabar, al pararla o al
 * ser sustituida (`false`), y si el motor falla o no hay síntesis de voz (`true`). Sin voz española usa la predeterminada.
 */
export function hablar(texto: string, alTerminar: (fallo: boolean) => void): void {
	parar();
	const synth = sintesis();
	if (!synth) { alTerminar(true); return; }
	if (!texto.trim()) { alTerminar(false); return; }
	let terminada = false;
	const lectura = { fin(fallo: boolean) { if (terminada) return; terminada = true; if (actual === lectura) actual = null; alTerminar(fallo); } };
	actual = lectura;
	void cargarVoces(synth).then(voces => {
		if (actual !== lectura) return;
		try {
			const frase = new SpeechSynthesisUtterance(texto);
			// Sin voz en español, la predeterminada del sistema; si el navegador solo ofreciera voces de red, no se habla: enviarían el texto fuera.
			const elegida = elegirVoz(voces) ?? voces.find(v => v.localService && v.default) ?? voces.find(v => v.localService) ?? null;
			if (voces.length && !elegida) { lectura.fin(true); return; }
			if (elegida) { frase.voice = elegida; frase.lang = elegida.lang; }
			frase.onend = () => lectura.fin(false);
			// Cancelar e interrumpir son parar, no fallar.
			frase.onerror = (e) => lectura.fin(e.error !== "canceled" && e.error !== "interrupted");
			synth.speak(frase);
		} catch {
			lectura.fin(true);
		}
	});
}
