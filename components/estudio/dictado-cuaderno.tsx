"use client";

/**
 * Dictar en el cuaderno (ticket 12i). Un micrófono en la cabecera y el atajo de dictado con el cursor en la página. Lo dictado
 * entra donde estaba el cursor al empezar (un párrafo, un campo de una tarjeta o el título), como texto de David, sin tocar el
 * resto de la página. El reconocimiento es local (Parakeet, `src/server/stt.ts`): el audio no sale del equipo.
 *
 * El texto entra por el mismo camino que lo tecleado: se cambia el valor del campo y se lanza su evento `input`, así cada campo
 * lo guarda con su lógica de siempre (un párrafo, el hueco del final que se vuelve bloque, una tarjeta o el título).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Loader2Icon, MicIcon, SquareIcon } from "lucide-react";
import { METER_TICK_MS, rmsToMeter } from "@/components/dictation";
import { claimPluginInputFocus, usePluginDictation } from "@/components/plugin-dictation";
import { cn } from "@/lib/utils";

/** Los campos de la página donde se puede dictar. */
const CAMPOS = 'textarea, input[name="titulo"]';
type CampoTexto = HTMLTextAreaElement | HTMLInputElement;

/** Dónde entra lo dictado: el campo y su selección al empezar. El bloque y el campo sirven si React rehace el elemento. */
interface Destino { el: CampoTexto; inicio: number; fin: number; bloque?: string; campo?: string }

/** Inserta lo dictado en `valor`, sustituyendo la selección, con un espacio a cada lado solo donde hace falta. */
export function insertarEnTexto(valor: string, inicio: number, fin: number, dictado: string): { valor: string; pos: number } {
	const a = Math.max(0, Math.min(inicio, valor.length));
	const b = Math.max(a, Math.min(fin, valor.length));
	const antes = valor.slice(0, a);
	const despues = valor.slice(b);
	const texto = dictado.trim();
	if (!texto) return { valor, pos: b };
	const izquierda = antes && !/\s$/.test(antes) ? " " : "";
	const derecha = despues && !/^[\s.,;:!?)\]»”]/.test(despues) ? " " : "";
	const insertado = izquierda + texto + derecha;
	return { valor: antes + insertado + despues, pos: a + izquierda.length + texto.length };
}

function destinoDe(el: CampoTexto): Destino {
	return {
		el, inicio: el.selectionStart ?? el.value.length, fin: el.selectionEnd ?? el.value.length,
		bloque: el.closest<HTMLElement>("[data-block-id]")?.dataset.blockId, campo: el.dataset.campo ?? el.name,
	};
}

/** El campo vivo del destino: el mismo elemento o, si React lo rehízo, el del mismo bloque y campo; si no, el final de la página. */
function campoVivo(raiz: HTMLElement, d: Destino | null): { el: CampoTexto; inicio: number; fin: number } | null {
	if (d?.el.isConnected) return d;
	if (d?.bloque) {
		const bloque = [...raiz.querySelectorAll<HTMLElement>("[data-block-id]")].find(x => x.dataset.blockId === d.bloque);
		const el = bloque?.querySelector<CampoTexto>(`[data-campo="${d.campo}"]`);
		if (el) return { el, inicio: d.inicio, fin: d.fin };
	}
	if (d?.campo === "titulo") {
		const el = raiz.querySelector<HTMLInputElement>('input[name="titulo"]');
		if (el) return { el, inicio: d.inicio, fin: d.fin };
	}
	const parrafos = raiz.querySelectorAll<HTMLTextAreaElement>('[data-block-id] textarea[data-campo="texto"]');
	const ultimo = parrafos[parrafos.length - 1];
	return ultimo ? { el: ultimo, inicio: ultimo.value.length, fin: ultimo.value.length } : null;
}

/** Cambia el valor como lo haría el teclado: el setter nativo (React ignora el otro) y el evento `input`. */
function escribirComoTeclado(el: CampoTexto, valor: string, pos: number) {
	// El setter del prototipo, no el de la instancia: React vigila este último para notar el cambio.
	let setter: ((v: string) => void) | undefined;
	for (let p = Object.getPrototypeOf(el); p && !setter; p = Object.getPrototypeOf(p)) setter = Object.getOwnPropertyDescriptor(p, "value")?.set;
	if (setter) setter.call(el, valor);
	else el.value = valor;
	el.setSelectionRange(pos, pos);
	el.dispatchEvent(new Event("input", { bubbles: true }));
	el.focus();
	el.setSelectionRange(pos, pos);
}

const CELDAS = 8;

export function DictadoCuaderno({ raiz }: { raiz: RefObject<HTMLDivElement | null> }) {
	/** El último campo de la página con su selección, guardado al salir de él (pulsar el micrófono le quita el foco). */
	const ultimo = useRef<Destino | null>(null);
	const destino = useRef<Destino | null>(null);

	const insertar = useCallback((texto: string) => {
		const r = raiz.current;
		if (!r) return;
		const vivo = campoVivo(r, destino.current);
		if (!vivo) return;
		const { valor, pos } = insertarEnTexto(vivo.el.value, vivo.inicio, vivo.fin, texto);
		if (valor !== vivo.el.value) escribirComoTeclado(vivo.el, valor, pos);
	}, [raiz]);
	const dictado = usePluginDictation({ append: insertar });

	const alternar = useCallback(() => {
		const r = raiz.current;
		if (dictado.phase === "idle" && r) {
			const activo = document.activeElement;
			destino.current = activo instanceof HTMLElement && r.contains(activo) && activo.matches(CAMPOS) ? destinoDe(activo as CampoTexto) : ultimo.current;
		}
		dictado.toggle();
	}, [dictado, raiz]);
	const vigente = useRef(alternar);
	vigente.current = alternar;

	useEffect(() => {
		const r = raiz.current;
		if (!r) return;
		const salir = (e: FocusEvent) => {
			const t = e.target;
			if (t instanceof HTMLElement && t.matches(CAMPOS)) ultimo.current = destinoDe(t as CampoTexto);
		};
		r.addEventListener("focusout", salir);
		// El atajo de dictado con el foco en la página es de este cuaderno.
		const soltar = claimPluginInputFocus(r, { toggleDictation: () => vigente.current() });
		return () => { r.removeEventListener("focusout", salir); soltar(); };
	}, [raiz]);

	const { phase, error, levelRef, active } = dictado;
	const [niveles, setNiveles] = useState<number[]>(() => new Array(CELDAS).fill(0));
	useEffect(() => {
		if (!active) return;
		setNiveles(new Array(CELDAS).fill(0));
		const id = setInterval(() => setNiveles(ring => [...ring.slice(1), rmsToMeter(levelRef.current)]), METER_TICK_MS);
		return () => clearInterval(id);
	}, [active, levelRef]);

	if (!active) {
		return (
			<>
				{/* El motivo de un fallo no ocupa la cabecera: el micrófono se pone en rojo y lo cuenta al pasar el ratón. */}
				{error && <span role="status" data-dictado-error className="sr-only">{`Falló el dictado: ${error}`}</span>}
				<button
					type="button" data-dictar onClick={alternar}
					aria-label={error ? `Dictar de nuevo (falló: ${error})` : "Dictar"}
					title={error ? `Falló el dictado: ${error}. Pulsa para intentarlo de nuevo` : "Dictar donde está el cursor"}
					className={cn("anillo-foco inline-flex size-7 items-center justify-center rounded-md hover:bg-accent", error ? "text-destructive" : "text-muted-foreground hover:text-foreground")}
				><MicIcon className="size-4" aria-hidden="true" /></button>
			</>
		);
	}
	const transcribiendo = phase === "stopping";
	return (
		<span className="inline-flex items-center gap-2" data-dictando={phase}>
			<button
				type="button" data-dictar onClick={alternar} disabled={transcribiendo}
				aria-label={transcribiendo ? "Transcribiendo" : "Detener dictado"} title={transcribiendo ? "Transcribiendo…" : "Detener dictado (Esc lo descarta)"}
				className="anillo-foco inline-flex h-7 items-center gap-1.5 rounded-md bg-destructive/10 px-2 font-sans text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-80"
			>
				{transcribiendo ? <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" /> : <SquareIcon className="size-3" aria-hidden="true" />}
				{transcribiendo ? "Transcribiendo…" : "Detener"}
			</button>
			{!transcribiendo && (
				<span aria-hidden="true" className="flex h-4 w-10 items-center gap-[2px]">
					{niveles.map((v, i) => <span key={i} className={cn("min-w-0 flex-1 rounded-full bg-destructive/60")} style={{ height: `${2 + Math.round(v * 14)}px` }} />)}
				</span>
			)}
		</span>
	);
}
