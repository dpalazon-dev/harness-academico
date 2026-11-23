"use client";

/**
 * La pantalla de intento dedicada (ticket 06, historias 35 y 36): el intento
 * ocupa la ventana, sin barra lateral ni acceso a fuentes, para que la fuente
 * quede de verdad retirada. Confianza, respuesta sin fuente, contraste y
 * valoración, con las operaciones de práctica de siempre; la lógica del
 * intento no cambia. Al valorar se vuelve a la unidad. Un intento terminado
 * se discute en una conversación nueva con la respuesta congelada y el
 * contraste como contexto (ADR 0003).
 *
 * `PantallaConfianzaEstudio` y `PantallaIntentoEstudio` son puras;
 * `PantallaPracticar` y `PantallaIntento` las conectan con el plugin.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { llamarEstudio } from "./llamar";
import { useAbrirConversacion } from "./abrir-conversacion";
import type { IntentoPublico, LecturaIntento, LecturaUnidad, Tarea, TipoFallo } from "./tipos";

export const TAREA: Record<Tarea, string> = {
	guiada: "Pregunta guiada", libre: "Reconstrucción libre", estructural: "Reconstrucción estructural",
	aplicada: "Caso aplicado", comparacion: "Comparación", transferencia: "Transferencia",
};
export const FIDELIDAD = ["No lo tenía", "Errores importantes", "Incompleto", "Completo"];
export const FALLO: Record<TipoFallo, string> = {
	acceso: "Acceso", precision: "Precisión", estructural: "Estructura", discriminacion: "Discriminación", aplicacion: "Aplicación", transferencia: "Transferencia",
};
const USO = ["No lo apliqué", "Con pistas", "Sin pistas"];
const PASOS = ["Confianza", "Respuesta", "Contraste", "Valoración"];
/** Escalera de pistas del plugin: cinco; el nivel 6 es «fuente abierta». */
const PISTAS = 5;
const FUENTE_ABIERTA = 6;

/** A dónde vuelve la pantalla al salir o al valorar: la unidad, salvo que se llegue con `?volver=` (los repasos que
 * lanza el inicio vuelven al inicio). Solo rutas propias de la app: nada que empiece por `//` ni con barra invertida. */
export function destinoDeVuelta(volver: string | null | undefined): string | null {
	return typeof volver === "string" && /^\/(?![/\\])[^\\]*$/.test(volver) ? volver : null;
}
const conVuelta = (ruta: string, volver?: string, otros: Record<string, string> = {}) => {
	const q = new URLSearchParams(otros);
	if (destinoDeVuelta(volver)) q.set("volver", volver!);
	const consulta = q.toString();
	return consulta ? `${ruta}?${consulta}` : ruta;
};

/** Una pregunta de recuperación de un cuaderno (ticket 09): se practica en vez de la tarea que prepara el modelo. */
export interface PreguntaCuaderno { cuaderno: string; bloque: string }

/** Las dos rutas de la pantalla de intento; ninguna pinta la barra lateral. */
export const rutaPracticar = (unitId: string, opciones: { volver?: string; pregunta?: PreguntaCuaderno } = {}) =>
	conVuelta(`/practicar/${unitId}`, opciones.volver, opciones.pregunta ? { cuaderno: opciones.pregunta.cuaderno, bloque: opciones.pregunta.bloque } : {});
export const rutaIntento = (attemptId: string, opciones: { volver?: string } = {}) => conVuelta(`/intento/${attemptId}`, opciones.volver);
/** El texto del botón que vuelve, según el destino. */
export const textoVolver = (destino: string | null) =>
	destino === "/" ? "Volver al inicio" : destino?.startsWith("/cuadernos/") ? "Volver al cuaderno" : "Volver a la unidad";

function Pasos({ actual }: { actual: number }) {
	return (
		<ol className="flex gap-4 text-xs" aria-label="Pasos del intento">
			{PASOS.map((p, i) => (
				<li key={p} data-estado={i < actual ? "hecho" : i === actual ? "actual" : "pendiente"}
					aria-current={i === actual ? "step" : undefined}
					className={cn("flex items-center gap-1.5", i === actual ? "text-foreground" : "text-muted-foreground")}>
					<span className={cn("size-1.5 rounded-full", i < actual ? "bg-primary" : i === actual ? "bg-foreground" : "bg-border")} />{p}
				</li>
			))}
		</ol>
	);
}

/** El marco común: sin barra lateral; arriba, la unidad y la salida. */
function Marco({ titulo, paso, salir, salirTexto = "Volver a la unidad", ocupado, children }: {
	titulo: string; paso: number; salir(): void; salirTexto?: string; ocupado: boolean; children: React.ReactNode;
}) {
	return (
		<div className="relative h-dvh overflow-y-auto bg-background font-prose" data-pantalla="intento">
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			<main className="mx-auto w-full max-w-3xl px-6 pb-24 pt-14">
				<header className="flex flex-wrap items-center gap-x-6 gap-y-3">
					<p className="flex-1 text-sm text-muted-foreground">Práctica · <span className="text-foreground">{titulo}</span></p>
					<Button size="sm" variant="ghost" disabled={ocupado} onClick={salir}>{salirTexto}</Button>
				</header>
				<div className="mt-4"><Pasos actual={paso} /></div>
				{children}
			</main>
		</div>
	);
}

/** Paso 1: la confianza se declara antes de ver la tarea. */
export function PantallaConfianzaEstudio({ titulo, confianza, ocupado, mensaje, error, volver = null, acciones }: {
	titulo: string;
	/** El destino de vuelta, si no es la unidad. */
	volver?: string | null;
	confianza: number;
	ocupado: boolean;
	/** Qué espera mientras el modelo prepara la tarea. */
	mensaje: string | null;
	error: string | null;
	acciones: { cambiar(valor: number): void; empezar(): void; salir(): void };
}) {
	return (
		<Marco titulo={titulo} paso={0} salir={acciones.salir} salirTexto={textoVolver(volver)} ocupado={ocupado}>
			<h1 className="mt-10 font-title text-3xl tracking-tight">¿Cuánto confías en recordarlo sin mirar?</h1>
			<p className="mt-2 text-sm text-muted-foreground">Decláralo antes de ver la tarea: después se compara con lo que de verdad recuerdas.</p>
			<label className="mt-8 flex items-center gap-3 text-sm">
				<span className="sr-only">Confianza antes de empezar</span>
				<span aria-hidden="true" className="text-xs text-muted-foreground">Nada</span>
				<input
					type="range" min={0} max={100} step={5} value={confianza} name="confidence" aria-label="Confianza antes de empezar"
					aria-valuetext={`${confianza} %`}
					disabled={ocupado} onChange={(e) => acciones.cambiar(Number(e.target.value))}
					className="flex-1 accent-primary"
				/>
				<span aria-hidden="true" className="text-xs text-muted-foreground">Seguro</span>
				<output className="w-14 text-right tabular-nums">{confianza} %</output>
			</label>
			<div className="mt-8 flex items-center gap-3">
				<Button disabled={ocupado} onClick={acciones.empezar}>Empezar</Button>
				{mensaje && <p className="text-sm text-muted-foreground" aria-live="polite">{mensaje}</p>}
			</div>
			{error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
		</Marco>
	);
}

/** Como en Cuadernos: lo que se ve junto a la respuesta mientras se guarda sola. */
export type EstadoGuardadoRespuesta = { tipo: "guardado" } | { tipo: "sin-guardar" } | { tipo: "guardando" } | { tipo: "error"; motivo: string };
const TEXTO_GUARDADO = { guardado: "Guardado", "sin-guardar": "Sin guardar", guardando: "Guardando…" } as const;
export const textoGuardadoRespuesta = (g: EstadoGuardadoRespuesta) => g.tipo === "error" ? `No se pudo guardar: ${g.motivo}` : TEXTO_GUARDADO[g.tipo];

/** Lo que se pregunta al salir si la respuesta no se pudo guardar. */
export const AVISO_SALIR_SIN_GUARDAR = "No se pudo guardar tu respuesta. Si sales ahora, perderás lo último que escribiste. ¿Salir de todos modos?";

/** Salir de un intento: primero se guarda; si falla, solo se sale si David lo confirma. */
export async function salirGuardando(guardar: () => Promise<void>, confirmar: (texto: string) => boolean, ir: () => void): Promise<void> {
	try {
		await guardar();
	} catch {
		if (!confirmar(AVISO_SALIR_SIN_GUARDAR)) return;
	}
	ir();
}

/**
 * La respuesta se guarda sola 1,5 s después de dejar de escribir, y antes de cada operación y de salir. `guardar` lanza si
 * falla, para que quien llama decida; el estado lo cuenta siempre.
 */
export function useGuardarRespuesta(id: string, abierto: boolean) {
	const [guardado, setGuardado] = useState<EstadoGuardadoRespuesta | null>(null);
	/** La última respuesta guardada en el plugin, para no guardar dos veces lo mismo. */
	const guardada = useRef("");
	const actual = useRef("");
	const espera = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const guardar = useCallback(async () => {
		clearTimeout(espera.current);
		const texto = actual.current;
		if (!abierto || texto === guardada.current) return;
		setGuardado({ tipo: "guardando" });
		try {
			await llamarEstudio("guardar-respuesta", { attemptId: id, answer: texto });
		} catch (e) {
			setGuardado({ tipo: "error", motivo: e instanceof Error ? e.message : "error desconocido" });
			throw e;
		}
		guardada.current = texto;
		setGuardado(actual.current === texto ? { tipo: "guardado" } : { tipo: "sin-guardar" });
	}, [abierto, id]);
	useEffect(() => () => clearTimeout(espera.current), []);
	const cargar = useCallback((texto: string) => { guardada.current = texto; actual.current = texto; }, []);
	return {
		guardado,
		guardar,
		/** Lo leído del plugin: ya está guardado. */
		cargar,
		/** Lo que David escribe: se guarda solo al rato. El fallo queda en `guardado`. */
		escribir: (texto: string) => {
			actual.current = texto;
			setGuardado(g => (g?.tipo === "error" ? g : { tipo: "sin-guardar" }));
			clearTimeout(espera.current);
			espera.current = setTimeout(() => void guardar().catch(() => {}), 1500);
		},
	};
}

export interface AccionesIntento {
	escribir(texto: string): void;
	congelar(): void;
	pista(): void;
	/** Ver la referencia sin haber terminado: el intento cuenta como no recuperado. */
	verReferencia(): void;
	abandonar(): void;
	autoevaluar(valoracion: { fidelity: number; failureType: TipoFallo | null; use?: number }): void;
	/** Abre una conversación nueva con la respuesta congelada y el contraste. */
	discutir(): void;
	/** Vuelve a la unidad (o al destino de vuelta); un intento a medias se conserva. */
	salir(): void;
}

/** Pasos 2 a 4: respuesta sin fuente, contraste y valoración, o el intento ya cerrado. */
export function PantallaIntentoEstudio({ intento, borrador, guardado = null, aviso, ocupado, mensaje, error, volver = null, acciones }: {
	intento: LecturaIntento;
	/** Cómo va el guardado de la respuesta mientras se escribe; null antes de escribir nada. */
	guardado?: EstadoGuardadoRespuesta | null;
	/** El destino de vuelta, si no es la unidad. */
	volver?: string | null;
	/** La respuesta tal como David la está escribiendo. */
	borrador: string;
	/** El contraste del modelo falló: se valora igualmente. */
	aviso: string | null;
	ocupado: boolean;
	mensaje: string | null;
	error: string | null;
	acciones: AccionesIntento;
}) {
	const { attempt: a } = intento;
	const paso = a.status === "open" ? 1 : a.status === "frozen" ? 3 : 4;
	const pie = (
		<>
			{mensaje && <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">{mensaje}</p>}
			{error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
		</>
	);
	const enunciado = (
		<section className="mt-10">
			<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
				<span className="rounded-md border border-border px-1.5 py-0.5 text-xs">{TAREA[a.taskKind]}</span>
				<span>Confianza declarada: {a.confidence} %</span>
			</div>
			<p className="mt-4 whitespace-pre-wrap text-lg leading-relaxed">{intento.prompt}</p>
			{intento.cues.length > 0 && a.status === "open" && (
				<ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted-foreground" aria-label="Pistas">
					{intento.cues.map((c, i) => <li key={i}>{c}</li>)}
				</ol>
			)}
		</section>
	);

	if (a.status === "abandoned") {
		return (
			<Marco titulo={intento.titulo} paso={1} salir={acciones.salir} salirTexto={textoVolver(volver)} ocupado={ocupado}>
				{enunciado}
				<p className="mt-8 text-sm text-muted-foreground">Abandonaste este intento antes de terminar la respuesta: no cuenta como evidencia.</p>
				{pie}
			</Marco>
		);
	}

	if (a.status === "open") {
		const fuenteAbierta = a.cueLevel > PISTAS;
		return (
			<Marco titulo={intento.titulo} paso={paso} salir={acciones.salir} salirTexto="Salir y seguir luego" ocupado={ocupado}>
				{enunciado}
				<textarea
					aria-label="Tu respuesta"
					value={borrador}
					maxLength={20000}
					rows={12}
					disabled={ocupado}
					autoFocus
					onChange={(e) => acciones.escribir(e.target.value)}
					placeholder="Escribe tu respuesta sin mirar ninguna fuente."
					className="lh-input mt-6 w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-base leading-relaxed text-foreground"
				/>
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<Button disabled={ocupado} onClick={acciones.congelar} aria-describedby="terminar-fija">Terminar y comparar</Button>
					<Button variant="outline" disabled={ocupado || a.cueLevel >= PISTAS} onClick={acciones.pista}>Necesito una pista</Button>
					<Button variant="ghost" disabled={ocupado || fuenteAbierta} onClick={acciones.verReferencia}>Me rindo: ver la referencia</Button>
					<Button variant="ghost" disabled={ocupado} onClick={acciones.abandonar}>Abandonar</Button>
					{guardado && (
						<span role="status" data-guardado={guardado.tipo} className={cn("ml-auto text-xs", guardado.tipo === "error" ? "text-destructive" : "text-muted-foreground")}>
							{textoGuardadoRespuesta(guardado)}
						</span>
					)}
				</div>
				<p id="terminar-fija" className="mt-2 text-xs text-muted-foreground">Al terminar, la respuesta queda fija: ya no podrás cambiarla.</p>
				{pie}
			</Marco>
		);
	}

	const juicio = a.judgments.at(-1) ?? null;
	const valoracion = a.grades.at(-1) ?? null;
	return (
		<Marco titulo={intento.titulo} paso={paso} salir={acciones.salir} salirTexto={textoVolver(volver)} ocupado={ocupado}>
			{enunciado}
			<div className="mt-8 grid gap-6 sm:grid-cols-2">
				<section>
					<h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Tu respuesta</h2>
					<p className="whitespace-pre-wrap rounded-xl border border-border px-4 py-3 text-sm leading-relaxed">{a.answer || "(vacía)"}</p>
					{a.cueLevel === FUENTE_ABIERTA && <p className="mt-1.5 text-xs text-muted-foreground">Viste la referencia antes de terminar: cuenta como no recuperado.</p>}
				</section>
				<section>
					<h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Referencia</h2>
					<p className="whitespace-pre-wrap text-sm leading-relaxed">{intento.reference}</p>
					{(intento.rubric?.length ?? 0) > 0 && (
						<ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground" aria-label="Rúbrica">
							{intento.rubric!.map((r, i) => <li key={i}>{r}</li>)}
						</ul>
					)}
				</section>
			</div>
			{aviso && <p role="alert" className="mt-4 text-sm text-destructive">{aviso}</p>}
			{juicio && (
				<section className="mt-8">
					<h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Contraste del modelo</h2>
					<p className="text-sm leading-relaxed">{FIDELIDAD[juicio.fidelity]}{juicio.failureType && ` · fallo de ${FALLO[juicio.failureType].toLowerCase()}`}. {juicio.rationale}</p>
				</section>
			)}
			{a.status === "frozen" ? (
				<Valorar key={a.id} intento={intento} ocupado={ocupado} autoevaluar={acciones.autoevaluar} />
			) : valoracion && (
				<p className="mt-8 text-sm">
					Tu valoración: {FIDELIDAD[valoracion.fidelity]}{valoracion.failureType ? ` · fallo de ${FALLO[valoracion.failureType].toLowerCase()}` : ""}.
				</p>
			)}
			<div className="mt-8 flex flex-wrap gap-2">
				{a.status === "graded" && <Button disabled={ocupado} onClick={acciones.salir}>{textoVolver(volver)}</Button>}
				<Button variant="outline" disabled={ocupado} onClick={acciones.discutir}><MessageSquareIcon className="size-4" />Discutir con el tutor</Button>
			</div>
			{pie}
		</Marco>
	);
}

/** La valoración: tipo de fallo (con el del modelo preseleccionado), uso en los casos aplicados y fidelidad. */
function Valorar({ intento, ocupado, autoevaluar }: { intento: IntentoPublico; ocupado: boolean; autoevaluar: AccionesIntento["autoevaluar"] }) {
	const { attempt: a } = intento;
	const [fallo, setFallo] = useState<TipoFallo | "">(a.judgments.at(-1)?.failureType ?? "");
	const [uso, setUso] = useState<number | null>(null);
	const [falta, setFalta] = useState(false);
	const aplicada = a.taskKind === "aplicada";
	return (
		<section className="mt-8 space-y-4" aria-label="Valoración">
			<h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Tu valoración</h2>
			<label className="grid max-w-xs gap-1 text-xs text-muted-foreground">
				Tipo de fallo
				<select aria-label="Tipo de fallo" value={fallo} disabled={ocupado} onChange={(e) => setFallo(e.target.value as TipoFallo | "")}
					className="lh-input h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground">
					<option value="">Sin fallo</option>
					{(Object.keys(FALLO) as TipoFallo[]).map(k => <option key={k} value={k}>{FALLO[k]}</option>)}
				</select>
			</label>
			{aplicada && (
				<div role="group" aria-label="¿Lo aplicaste?" className="flex flex-wrap items-center gap-2 text-sm">
					<span className="mr-1">¿Lo aplicaste?</span>
					{USO.map((u, i) => (
						<Button key={u} size="sm" variant={uso === i ? "secondary" : "outline"} aria-pressed={uso === i} disabled={ocupado}
							onClick={() => { setUso(i); setFalta(false); }}>{u}</Button>
					))}
				</div>
			)}
			<div role="group" aria-label="Fidelidad" className="flex flex-wrap items-center gap-2 text-sm">
				<span className="mr-1">Comparada con la referencia, tu respuesta:</span>
				{FIDELIDAD.map((f, i) => (
					<Button key={f} size="sm" variant="outline" disabled={ocupado} onClick={() => {
						if (aplicada && uso === null) { setFalta(true); return; }
						autoevaluar({ fidelity: i, failureType: fallo || null, ...(uso === null ? {} : { use: uso }) });
					}}>{f}</Button>
				))}
			</div>
			{falta && <p role="alert" className="text-sm text-destructive">Indica primero si lo aplicaste.</p>}
		</section>
	);
}

/** «Practicar» desde la unidad: con un intento a medias lo retoma; si no, pide la confianza y empieza. Con una
 * pregunta de cuaderno, empieza con ella (`practicar-pregunta`) en vez de con la tarea que prepara el modelo. */
export function PantallaPracticar({ unitId, volver: pedido, pregunta }: { unitId: string; volver?: string; pregunta?: PreguntaCuaderno }) {
	const router = useRouter();
	const destino = destinoDeVuelta(pedido);
	const [unidad, setUnidad] = useState<LecturaUnidad | null>(null);
	const [confianza, setConfianza] = useState(50);
	const [ocupado, setOcupado] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const volver = useCallback(() => router.push(destino ?? `/unidad/${unitId}`), [router, unitId, destino]);

	useEffect(() => {
		let vivo = true;
		llamarEstudio<LecturaUnidad>("unidad", { id: unitId }).then(u => {
			if (!vivo) return;
			const abierto = u.intentos.find(i => i.estado === "open" || i.estado === "frozen");
			if (abierto) router.replace(rutaIntento(abierto.id, { volver: destino ?? undefined }));
			else setUnidad(u);
		}, (e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : "No se pudo leer la unidad."); });
		return () => { vivo = false; };
	}, [router, unitId, destino]);
	useEscape(volver, ocupado);

	const empezar = async () => {
		setOcupado(true);
		setError(null);
		try {
			const intento = pregunta
				? await llamarEstudio<IntentoPublico>("practicar-pregunta", { notebookId: pregunta.cuaderno, blockId: pregunta.bloque, confidence: confianza })
				: await llamarEstudio<IntentoPublico>("empezar", { unitId, confidence: confianza });
			router.replace(rutaIntento(intento.attempt.id, { volver: destino ?? undefined }));
		} catch (e) {
			setError(e instanceof Error ? e.message : "No se pudo preparar la tarea.");
			setOcupado(false);
		}
	};

	if (!unidad) {
		return (
			<Marco titulo="" paso={0} salir={volver} salirTexto={textoVolver(destino)} ocupado={false}>
				<p className={cn("mt-10 text-sm", error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : undefined}>{error ?? "Cargando…"}</p>
			</Marco>
		);
	}
	return (
		<PantallaConfianzaEstudio
			titulo={unidad.titulo}
			confianza={confianza}
			ocupado={ocupado}
			mensaje={ocupado ? "El modelo está preparando la tarea…" : null}
			error={error}
			volver={destino}
			acciones={{ cambiar: setConfianza, empezar: () => void empezar(), salir: volver }}
		/>
	);
}

/** Escape sale de la pantalla, salvo mientras una operación está en curso o
 * con el foco en un campo: escribiendo la respuesta, Escape no la deja. */
function useEscape(salir: () => void, ocupado: boolean) {
	useEffect(() => {
		const tecla = (e: KeyboardEvent) => {
			const campo = e.target instanceof Element && e.target.closest("textarea, input, select");
			if (e.key === "Escape" && !e.defaultPrevented && !ocupado && !campo) salir();
		};
		window.addEventListener("keydown", tecla);
		return () => window.removeEventListener("keydown", tecla);
	}, [salir, ocupado]);
}

/** Un intento por su id: lo retoma si está a medias, lo valora si está congelado y lo muestra si está cerrado. */
export function PantallaIntento({ id, initialConfigured, volver: pedido }: { id: string; initialConfigured: boolean; volver?: string }) {
	const router = useRouter();
	const destino = destinoDeVuelta(pedido);
	const conversacion = useAbrirConversacion(initialConfigured);
	const [intento, setIntento] = useState<LecturaIntento | null>(null);
	const [borrador, setBorrador] = useState("");
	const [aviso, setAviso] = useState<string | null>(null);
	const [ocupado, setOcupado] = useState(false);
	const [mensaje, setMensaje] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const abierto = intento?.attempt.status === "open";
	const respuesta = useGuardarRespuesta(id, abierto);
	const { guardar, cargar } = respuesta;

	useEffect(() => {
		let vivo = true;
		llamarEstudio<LecturaIntento>("intento", { attemptId: id }).then(leido => {
			if (!vivo) return;
			setIntento(leido);
			setBorrador(leido.attempt.answer);
			cargar(leido.attempt.answer);
		}, (e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : "No se pudo leer el intento."); });
		return () => { vivo = false; };
	}, [id, cargar]);

	const unidad = destino ?? (intento ? `/unidad/${intento.attempt.unitId}` : "/");
	const salir = useCallback(() => {
		void salirGuardando(guardar, (texto) => window.confirm(texto), () => router.push(unidad));
	}, [guardar, router, unidad]);
	useEscape(salir, ocupado || conversacion.abriendo);

	/** Pinta lo que devuelve una operación; `empezar`, `pista` y `autoevaluar` traen el intento, `congelar` y `abrir-fuente` además el aviso. */
	const pintar = (r: IntentoPublico | { attempt: IntentoPublico; warning: string | null }) => {
		const publico = "warning" in r ? r.attempt : r;
		setAviso("warning" in r ? r.warning : null);
		setIntento(prev => ({ ...publico, titulo: prev?.titulo ?? "" }));
	};
	const operar = async (operacion: string, entrada: Record<string, unknown> = {}, espera: string | null = null) => {
		setOcupado(true);
		setMensaje(espera);
		setError(null);
		try {
			await guardar();
			const r = await llamarEstudio<IntentoPublico | { attempt: IntentoPublico; warning: string | null }>(operacion, { attemptId: id, ...entrada });
			pintar(r);
			return r;
		} catch (e) {
			setError(e instanceof Error ? e.message : "No se pudo completar la operación.");
			return null;
		} finally {
			setOcupado(false);
			setMensaje(null);
		}
	};

	if (!intento) {
		return (
			<Marco titulo="" paso={1} salir={() => router.push("/")} salirTexto="Ir a Inicio" ocupado={false}>
				<p className={cn("mt-10 text-sm", error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : undefined}>{error ?? "Cargando…"}</p>
			</Marco>
		);
	}
	return (
		<>
			<PantallaIntentoEstudio
				intento={intento}
				borrador={borrador}
				guardado={respuesta.guardado}
				aviso={aviso}
				ocupado={ocupado || conversacion.abriendo}
				mensaje={mensaje}
				error={error ?? conversacion.error}
				volver={destino}
				acciones={{
					escribir: (texto) => {
						setBorrador(texto);
						respuesta.escribir(texto);
					},
					congelar: () => void operar("congelar", {}, "Respuesta terminada; ya no se puede cambiar. El modelo está preparando el contraste…"),
					pista: () => void operar("pista"),
					verReferencia: () => {
						if (window.confirm("Si ves la referencia ahora, el intento contará como no recuperado. ¿Continuar?")) {
							void operar("abrir-fuente", {}, "El modelo está preparando el contraste…");
						}
					},
					abandonar: () => {
						if (window.confirm("¿Abandonar el intento? No contará como evidencia.")) {
							void operar("abandonar").then(r => { if (r) router.push(unidad); });
						}
					},
					autoevaluar: (valoracion) => void operar("autoevaluar", valoracion).then(r => { if (r) router.push(unidad); }),
					discutir: () => void conversacion.abrir(`Intento sobre ${intento.titulo}`, { tipo: "intento", attemptId: intento.attempt.id }),
					salir,
				}}
			/>
			{conversacion.dialogo}
		</>
	);
}
