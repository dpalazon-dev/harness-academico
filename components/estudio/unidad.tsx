"use client";

/**
 * La página de una unidad (ticket 02, ADR 0002): capacidad, criterio, tipo y
 * etapa; el estado de los cuatro grupos del ciclo; fuentes, notas, preguntas,
 * intentos con el próximo repaso y conversaciones. Desde aquí se ajustan el
 * tipo y la forma de practicar, y una unidad propuesta se confirma o archiva. Dice en qué plan está (el de su tema)
 * y muestra la capacidad y el criterio que sugirió el tutor, para aceptarlos o descartarlos (spec de planes).
 * «Estudiar con el tutor» abre una conversación nueva con la unidad como
 * contexto (ticket 03, ADR 0003). El volcado inicial se escribe aquí, sin IA,
 * y queda como «lo que sabía antes» (ticket 04). «Practicar» abre la pantalla
 * de intento dedicada y un intento a medias se retoma desde aquí; un intento
 * terminado se abre o se discute con el tutor (ticket 06). Cada fuente abre el
 * lector con la unidad, para que lo capturado quede en ella (ticket 05). La
 * unidad muestra su paso propuesto con su motivo y lo ejecuta con un clic
 * (ticket 07, ADR 0004); reconstruir una fuente capturada es ese paso. Sus
 * cuadernos se abren desde aquí, se crea uno vinculado a ella y sus preguntas
 * de recuperación se practican en la pantalla de intento (ticket 09).
 *
 * `PaginaUnidadEstudio` es pura; `PaginaUnidad` la conecta con el plugin.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, BookOpenIcon, GraduationCapIcon, MessageSquareIcon, NotebookPenIcon, PencilLineIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { cn } from "@/lib/utils";
import { GRUPOS, TEXTO_ESTADO, TONO_ESTADO } from "./ciclo";
import { llamarEstudio } from "./llamar";
import { rutaPlan } from "./plan";
import { useAbrirConversacion } from "./abrir-conversacion";
import { FIDELIDAD, TAREA, rutaIntento, rutaPracticar } from "./intento";
import type { LecturaUnidad, Paso, PracticaUnidad, TipoUnidad } from "./tipos";
import { ANCLA_VOLCADO, destinoDelPaso } from "./paso";
import { RUTA_BIBLIOTECA, rutaLector } from "./documentos";
import { crearCuaderno, rutaCuaderno } from "./cuadernos";

export const TIPO: Record<TipoUnidad, string> = { concepto: "Concepto", procedimiento: "Procedimiento", argumento: "Argumento", modelo: "Modelo o sistema" };
export const PRACTICA: Record<PracticaUnidad, string> = {
	recordar: "Recordar: pregunta directa", reconstruir: "Reconstruir: explicarlo sin mirar",
	ejecutar: "Ejecutar: casos aplicados", localizar: "Solo saber dónde está: sin repasos",
};
const ESTADO_INTENTO = { open: "En curso", frozen: "Sin valorar", abandoned: "Abandonado" } as const;

export interface AccionesUnidad {
	ajustar(cambios: { kind?: TipoUnidad | null; policy?: PracticaUnidad | null }): void;
	confirmar(): void;
	archivar(): void;
	/** Copia a la unidad la capacidad y el criterio que sugirió el tutor. */
	aceptarSugerencia(): void;
	descartarSugerencia(): void;
	/** Lleva la unidad a otro espacio; null la deja sin espacio. */
	moverAEspacio(areaId: string | null): void;
	/** Abre una conversación nueva con la unidad como contexto. */
	estudiar(): void;
	/** Abre una conversación nueva con el intento terminado como contexto. */
	discutir(attemptId: string): void;
	/** Guarda el volcado inicial; no se cambia después. */
	guardarVolcado(texto: string): void;
	/** Ejecuta el paso propuesto de la unidad. */
	paso(paso: Paso): void;
	/** Crea un cuaderno vinculado a la unidad y lo abre. */
	nuevoCuaderno(): void;
	navegar(ruta: string): void;
}

const mes = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" });
const corta = (d: Date) => mes.format(d).replace(".", "");

/** Una fecha local `AAAA-MM-DD` dicha respecto de hoy. */
function cuando(dia: string, ahora: Date): string {
	const [a, m, d] = dia.split("-").map(Number);
	const fecha = new Date(a!, m! - 1, d!);
	const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
	const dias = Math.round((fecha.getTime() - hoy.getTime()) / 86_400_000);
	if (dias < 0) return `vencido desde el ${corta(fecha)}`;
	if (dias === 0) return "hoy";
	if (dias === 1) return "mañana";
	return corta(fecha);
}

export function PaginaUnidadEstudio({ unidad: u, espacios = null, ahora = new Date(), ocupado, error, acciones }: {
	unidad: LecturaUnidad;
	/** Los espacios no archivados a los que se puede llevar la unidad; null mientras cargan. */
	espacios?: { id: string; name: string }[] | null;
	ahora?: Date;
	/** Una operación en curso: los controles esperan. */
	ocupado: boolean;
	error: string | null;
	acciones: AccionesUnidad;
}) {
	const etapa = u.estado === "propuesta" ? "Propuesta del tutor" : u.estado === "archivada" ? "Archivada" : u.etapa.label;
	const editable = u.estado !== "archivada";
	const enCurso = u.intentos.find(i => i.estado === "open" || i.estado === "frozen") ?? null;
	return (
		<article className="mx-auto w-full max-w-2xl px-6 pb-24 pt-14">
			<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
				<span className="rounded-md border border-border px-1.5 py-0.5 text-xs">{u.tipo ? TIPO[u.tipo] : "Sin tipo"}</span>
				<span>{etapa}</span>
			</div>
			<h1 className="mt-3 font-title text-4xl tracking-tight">{u.titulo}</h1>
			<p className="mt-3 text-lg leading-relaxed">{u.capacidad || <span className="text-muted-foreground">Sin capacidad escrita.</span>}</p>
			{u.criterio && <p className="mt-1 text-sm text-muted-foreground">Sabrás que puedes cuando: {u.criterio}</p>}

			{u.estado === "activa" && (
				<div className="mt-6 flex flex-wrap gap-2">
					<Button disabled={ocupado} onClick={acciones.estudiar}>
						<GraduationCapIcon className="size-4" />Estudiar con el tutor
					</Button>
					{enCurso ? (
						<Button variant="outline" disabled={ocupado} onClick={() => acciones.navegar(rutaIntento(enCurso.id))}>
							<PencilLineIcon className="size-4" />{enCurso.estado === "open" ? "Retomar el intento" : "Valorar el intento"}
						</Button>
					) : (
						<Button variant="outline" disabled={ocupado} onClick={() => acciones.navegar(rutaPracticar(u.id))}>
							<PencilLineIcon className="size-4" />Practicar
						</Button>
					)}
				</div>
			)}

			{error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}

			{u.estado === "propuesta" && (
				<div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl bg-accent/60 p-4">
					<p className="flex-1 text-sm">El tutor propuso esta unidad. Confírmala para trabajarla o archívala.</p>
					<Button size="sm" disabled={ocupado} onClick={acciones.confirmar}>Confirmar</Button>
					<Button size="sm" variant="ghost" disabled={ocupado} onClick={acciones.archivar}>Archivar</Button>
				</div>
			)}

			<ol className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Ciclo de la unidad">
				{GRUPOS.map(g => (
					<li key={g.id} className="space-y-1.5">
						<span className={cn("block h-1 rounded-full", TONO_ESTADO[u.ciclo[g.id]])} />
						<p className="text-sm font-medium">{g.nombre}</p><p className="text-xs text-muted-foreground">{TEXTO_ESTADO[u.ciclo[g.id]]}</p>
					</li>
				))}
			</ol>

			{/* Una propuesta ya se decide en su recuadro de arriba: su paso no se repite. */}
			{u.paso && u.paso.tipo !== "decidir" && (
				<div className="mt-8 flex flex-wrap items-center gap-4 rounded-xl bg-accent/60 p-4" data-paso={u.paso.tipo}>
					<ArrowRightIcon className="size-4 shrink-0 text-[var(--lh-warning)]" />
					<div className="min-w-0 flex-1"><p className="font-medium">{u.paso.accion}</p><p className="text-sm text-muted-foreground">{u.paso.motivo}</p></div>
					<Button disabled={ocupado} onClick={() => acciones.paso(u.paso!)}>{u.paso.boton}</Button>
				</div>
			)}

			<Volcado unidad={u} ocupado={ocupado} editable={editable} guardar={acciones.guardarVolcado} />

			<div className="mt-8 grid gap-3 sm:grid-cols-2">
				<label className="grid gap-1 text-xs text-muted-foreground">
					Tipo de conocimiento
					<select
						aria-label="Tipo de conocimiento"
						value={u.tipo ?? ""}
						disabled={ocupado || !editable}
						onChange={(e) => acciones.ajustar({ kind: (e.target.value || null) as TipoUnidad | null })}
						className="lh-input h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
					>
						<option value="">Sin indicar</option>
						{(Object.keys(TIPO) as TipoUnidad[]).map(k => <option key={k} value={k}>{TIPO[k]}</option>)}
					</select>
				</label>
				<label className="grid gap-1 text-xs text-muted-foreground">
					Forma de practicar
					<select
						aria-label="Forma de practicar"
						value={u.practica ?? ""}
						disabled={ocupado || !editable}
						onChange={(e) => acciones.ajustar({ policy: (e.target.value || null) as PracticaUnidad | null })}
						className="lh-input h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
					>
						<option value="">Según el tipo: {u.practicaEfectiva}</option>
						{(Object.keys(PRACTICA) as PracticaUnidad[]).map(k => <option key={k} value={k}>{PRACTICA[k]}</option>)}
					</select>
				</label>
				{espacios && (
					<label className="grid gap-1 text-xs text-muted-foreground">
						Espacio
						<select
							aria-label="Espacio de la unidad"
							value={u.areaId ?? ""}
							disabled={ocupado || !editable}
							onChange={(e) => acciones.moverAEspacio(e.target.value || null)}
							className="lh-input h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
						>
							<option value="">Sin espacio</option>
							{espacios.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
						</select>
					</label>
				)}
			</div>
			{u.sugerencia && u.estado !== "archivada" && (
				<div className="mt-6 space-y-2 rounded-xl bg-accent/60 p-4 text-sm" data-testid="sugerencia">
					<p className="text-xs text-muted-foreground">El tutor sugiere</p>
					<p>{u.sugerencia.capacidad}</p>
					<p className="text-muted-foreground">Sabrás que puedes cuando: {u.sugerencia.criterio}</p>
					<div className="flex gap-1">
						<Button size="sm" disabled={ocupado} onClick={acciones.aceptarSugerencia}>Aceptar</Button>
						<Button size="sm" variant="ghost" disabled={ocupado} onClick={acciones.descartarSugerencia}>Descartar</Button>
					</div>
				</div>
			)}
			<p className="mt-4 text-sm text-muted-foreground" data-testid="plan-de-unidad">
				{u.plan ? <>Tema del plan <button type="button" className="text-foreground hover:underline" onClick={() => acciones.navegar(rutaPlan(u.plan!.id))}>«{u.plan.objetivo}»</button></> : "Sin plan"}
			</p>
			{u.estado === "activa" && (
				<div className="mt-3">
					<Button size="sm" variant="ghost" disabled={ocupado} onClick={acciones.archivar}>Archivar unidad</Button>
				</div>
			)}

			<Bloque titulo="Fuentes">
				{u.fuentes.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						Ninguna fuente todavía. Vincula un documento a esta unidad desde la Biblioteca para exponerte a él.{" "}
						<Button variant="link" className="h-auto p-0" onClick={() => acciones.navegar(RUTA_BIBLIOTECA)}>Ir a la Biblioteca</Button>
					</p>
				) : u.fuentes.map(f => {
					const datos = (
						<>
							<BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
							<span className="flex-1 text-sm">
								{f.titulo}
								{f.localizador && <span className="text-muted-foreground"> · {f.localizador}</span>}
							</span>
							<span className="text-xs text-muted-foreground">
								{f.capturas === 1 ? "1 nota" : `${f.capturas} notas`}{f.capturas > 0 && (f.reconstruida ? " · reconstruida" : " · sin reconstruir")}
							</span>
						</>
					);
					return (
						<div key={`${f.path}#${f.localizador ?? ""}`} className="flex items-center gap-1">
							{f.documentoId ? (
								<a
									href={rutaLector(f.documentoId, { unidad: u.id })}
									onClick={(e) => { e.preventDefault(); acciones.navegar(rutaLector(f.documentoId!, { unidad: u.id })); }}
									className="anillo-foco flex flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent"
								>{datos}</a>
							) : <div className="flex flex-1 items-center gap-3 px-2 py-2">{datos}</div>}
						</div>
					);
				})}
			</Bloque>

			<Bloque titulo="Cuadernos">
				{u.cuadernos.length === 0 ? (
					<p className="text-sm text-muted-foreground">Ningún cuaderno vinculado a esta unidad.</p>
				) : (
					<ul>
						{u.cuadernos.map(c => (
							<li key={c.id} data-notebook-id={c.id}>
								<a
									href={rutaCuaderno(c.id)}
									onClick={(e) => { e.preventDefault(); acciones.navegar(rutaCuaderno(c.id)); }}
									className="anillo-foco flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent"
								>
									<NotebookPenIcon className="size-4 shrink-0 text-muted-foreground" />
									<span className="flex-1 truncate text-sm">{c.titulo}</span>
									<span className="text-xs text-muted-foreground">
										{[c.notas === 1 ? "1 nota" : `${c.notas} notas`, c.preguntas ? (c.preguntas === 1 ? "1 pregunta" : `${c.preguntas} preguntas`) : ""].filter(Boolean).join(" · ")}
									</span>
								</a>
							</li>
						))}
					</ul>
				)}
				{u.estado === "activa" && (
					<Button size="sm" variant="ghost" className="mt-1" disabled={ocupado} onClick={acciones.nuevoCuaderno}><PlusIcon />Nuevo cuaderno</Button>
				)}
			</Bloque>

			<Bloque titulo="Notas y preguntas">
				{u.notas.length === 0 && u.preguntas.length === 0 ? (
					<p className="text-sm text-muted-foreground">Sin notas ni preguntas vinculadas a esta unidad.</p>
				) : (
					<ul className="space-y-1.5 text-sm">
						{u.notas.map(n => (
							<li key={`${n.cuadernoId}/${n.id}`} className="px-2">
								{n.simbolo && <span className="mr-1.5 text-muted-foreground">{n.simbolo}</span>}{n.texto}
								{n.cita && <q className={cn("italic text-muted-foreground", n.texto && "ml-1.5")}>{n.cita}</q>}
								{n.localizador && <span className="text-muted-foreground"> ({n.localizador})</span>}
							</li>
						))}
						{u.preguntas.map(q => (
							<li key={`${q.cuadernoId}/${q.id}`} className="flex items-baseline gap-2 px-2">
								<span className="flex-1"><span className="mr-1.5 text-muted-foreground">Pregunta:</span>{q.pregunta}</span>
								{u.estado === "activa" && !enCurso && (
									<Button size="sm" variant="ghost" className="h-7" disabled={ocupado}
										onClick={() => acciones.navegar(rutaPracticar(u.id, { pregunta: { cuaderno: q.cuadernoId, bloque: q.id } }))}>Practicar</Button>
								)}
							</li>
						))}
					</ul>
				)}
			</Bloque>

			<Bloque titulo="Intentos">
				{u.intentos.length === 0 ? <p className="text-sm text-muted-foreground">Sin intentos todavía.</p> : u.intentos.map(i => (
					<div key={i.id} className="flex items-center gap-3 rounded-lg px-2 py-1 text-sm hover:bg-accent/50">
						<button type="button" onClick={() => acciones.navegar(rutaIntento(i.id))} className="anillo-foco flex flex-1 items-baseline gap-3 py-0.5 text-left">
							<span className="w-16 shrink-0 tabular-nums text-muted-foreground">{corta(new Date(i.fecha))}</span>
							<span className="flex-1">
								{TAREA[i.tarea]} · <span className="text-muted-foreground">{i.estado === "graded" && i.fidelidad !== null ? FIDELIDAD[i.fidelidad] : ESTADO_INTENTO[i.estado as keyof typeof ESTADO_INTENTO] ?? "Valorado"}</span>
							</span>
						</button>
						{(i.estado === "frozen" || i.estado === "graded") && (
							<Button size="sm" variant="ghost" disabled={ocupado} onClick={() => acciones.discutir(i.id)}>Discutir</Button>
						)}
					</div>
				))}
				{u.proximoRepaso && <p className="mt-2 px-2 text-sm text-muted-foreground">Próximo repaso: {cuando(u.proximoRepaso, ahora)}</p>}
			</Bloque>

			<Bloque titulo="Conversaciones">
				{u.conversaciones.length === 0 ? <p className="text-sm text-muted-foreground">Ninguna conversación sobre esta unidad todavía.</p> : u.conversaciones.map(c => (
					<button key={c.id} type="button" onClick={() => acciones.navegar(`/chat/${c.id}`)} className="anillo-foco flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-accent" data-chat-id={c.id}>
						<MessageSquareIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1">
							<span className="block truncate">{c.title}</span>
							<ResumenConversacion conversacion={c} />
						</span>
					</button>
				))}
			</Bloque>
		</article>
	);
}

/** Lo que dejó una conversación según su resumen (ticket 11, de la pestaña Conversaciones de la vista antigua):
 * de qué trató, qué quedó abierto y qué sigue. Se pide ya desde el menú de la conversación en la barra lateral. */
function ResumenConversacion({ conversacion: c }: { conversacion: LecturaUnidad["conversaciones"][number] }) {
	const r = c.resumen;
	return (
		<span className="mt-0.5 block space-y-0.5 text-xs text-muted-foreground">
			{r ? <>
				<span className="block text-foreground/80">{r.tema}</span>
				{r.abierto.length > 0 && <span className="block">Quedó abierto: {r.abierto.join("; ")}</span>}
				{r.siguiente && <span className="block">Siguiente paso: {r.siguiente}</span>}
				{c.resumenAntiguo && <span className="block italic">El resumen es anterior a los últimos mensajes.</span>}
			</> : !c.resumenError && <span className="block">Sin resumen todavía: se hace tras 20 minutos sin actividad o con «Resumir ahora» en su menú.</span>}
			{c.resumenError && <span className="block text-destructive">{c.resumenError}</span>}
		</span>
	);
}

function enfocarVolcado() {
	const campo = document.getElementById(ANCLA_VOLCADO);
	campo?.scrollIntoView({ block: "center", behavior: "smooth" });
	campo?.focus({ preventScroll: true });
}

const dia = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric" });

/** «Lo que sabía antes»: el volcado ya escrito, o el campo para escribirlo sin ayuda. */
function Volcado({ unidad: u, ocupado, editable, guardar }: { unidad: LecturaUnidad; ocupado: boolean; editable: boolean; guardar(texto: string): void }) {
	const [texto, setTexto] = useState("");
	if (u.volcado) {
		return (
			<Bloque titulo="Lo que sabía antes">
				<p className="whitespace-pre-wrap rounded-xl border border-border px-4 py-3 text-sm leading-relaxed">{u.volcado.texto}</p>
				<p className="mt-1.5 px-1 text-xs text-muted-foreground">
					Escrito el {dia.format(new Date(u.volcado.fecha))}{u.volcado.origen === "sondeo" ? ", al pedírtelo el tutor" : ""}.
				</p>
			</Bloque>
		);
	}
	if (!editable) return null;
	return (
		<Bloque titulo="Lo que sabía antes">
			<p className="mb-2 text-sm text-muted-foreground">
				Antes de estudiar, escribe sin ayuda qué sabes, qué crees, qué no sabes y qué te preguntas. Es el «antes» con el que compararás lo que aprendas: una vez guardado no se cambia.
			</p>
			<textarea
				id={ANCLA_VOLCADO}
				aria-label="Volcado inicial"
				value={texto}
				onChange={(e) => setTexto(e.target.value)}
				disabled={ocupado}
				rows={6}
				placeholder={"Sé que…\nCreo que…\nNo sé…\n¿…?"}
				className="lh-input w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm leading-relaxed text-foreground"
			/>
			<div className="mt-2">
				<Button size="sm" disabled={ocupado || texto.trim() === ""} onClick={() => guardar(texto)}>Guardar volcado</Button>
			</div>
		</Bloque>
	);
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
	return (
		<section className="mt-10">
			<h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{titulo}</h2>
			{children}
		</section>
	);
}

/** La página conectada: lee la unidad del espacio activo y se refresca con los avisos del plugin. */
export function PaginaUnidad({ id, initialConfigured }: { id: string; initialConfigured: boolean }) {
	const router = useRouter();
	const conversacion = useAbrirConversacion(initialConfigured);
	const [unidad, setUnidad] = useState<LecturaUnidad | null>(null);
	const [falta, setFalta] = useState<string | null>(null);
	const [ocupado, setOcupado] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [espacios, setEspacios] = useState<{ id: string; name: string; archived: boolean }[] | null>(null);

	/** Solo pinta la lectura más reciente: los avisos del plugin y las operaciones leen a la vez. */
	const ultima = useRef(0);
	const leer = useCallback(async () => {
		const esta = ++ultima.current;
		// Los espacios solo hacen falta para el selector: si fallan, la página sigue sin él.
		void llamarEstudio<{ areas: { id: string; name: string; archived: boolean }[] }>("espacios")
			.then(e => { if (esta === ultima.current) setEspacios(e.areas); }, () => setEspacios(null));
		try {
			const leida = await llamarEstudio<LecturaUnidad>("unidad", { id });
			if (esta !== ultima.current) return;
			setUnidad(leida);
			setFalta(null);
		} catch (e) {
			if (esta !== ultima.current) return;
			setUnidad(null);
			setFalta(e instanceof Error ? e.message : "No se pudo leer la unidad.");
		}
	}, [id]);
	useEffect(() => { void leer(); }, [leer]);
	// El paso «Escribe lo que ya sabes» del inicio llega con el ancla del volcado: se enfoca en cuanto se pinta.
	const cargada = unidad !== null;
	useEffect(() => { if (cargada && window.location.hash === `#${ANCLA_VOLCADO}`) enfocarVolcado(); }, [cargada]);
	useServerEvent("plugin-message", (m) => { if (m.pluginId === "estudio") void leer(); });
	// Renombrar o borrar una conversación desde otra ventana cambia el bloque «Conversaciones» (ticket 12).
	useServerEvent("chats-changed", () => void leer());
	useServerResync(() => void leer());
	// Renombrada en esta ventana (barra lateral o cabecera del chat): el título cambia al momento.
	useEffect(() => {
		const renombrada = (e: Event) => {
			const { id: chatId, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
			setUnidad(prev => prev && { ...prev, conversaciones: prev.conversaciones.map(c => (c.id === chatId ? { ...c, title } : c)) });
		};
		window.addEventListener("lh:chat-renamed", renombrada);
		return () => window.removeEventListener("lh:chat-renamed", renombrada);
	}, []);

	const operar = async (operation: string, input: Record<string, unknown>) => {
		if (!unidad) return;
		setOcupado(true);
		setError(null);
		try {
			if (operation === "mover-a-espacio") {
				await llamarEstudio(operation, { kind: "unidad", id: unidad.id, areaId: input.areaId });
			} else if (operation === "guardar-volcado") {
				await llamarEstudio(operation, { unitId: unidad.id, ...input });
			} else {
				await llamarEstudio(operation, { id: unidad.id, expectedRevision: unidad.revision, ...input });
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : "No se pudo cambiar la unidad.");
		}
		await leer();
		setOcupado(false);
	};

	/** Como «Nuevo cuaderno» en Cuadernos y en ⌘K, ya vinculado a la unidad. */
	const nuevoCuaderno = async () => {
		if (!unidad) return;
		setOcupado(true);
		setError(null);
		try {
			const c = await crearCuaderno(unidad.id);
			router.push(rutaCuaderno(c.id, { nuevo: true }));
		} catch (e) {
			setError(e instanceof Error ? e.message : "No se pudo crear el cuaderno.");
			setOcupado(false);
		}
	};

	return (
		<div className="relative h-dvh overflow-y-auto font-prose">
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			{unidad ? (
				<PaginaUnidadEstudio
					unidad={unidad}
					// Los vivos y, si está archivado, el suyo: el selector enseña siempre dónde está.
					espacios={espacios?.filter(a => !a.archived || a.id === unidad.areaId) ?? null}
					ocupado={ocupado || conversacion.abriendo}
					error={error ?? conversacion.error}
					acciones={{
						estudiar: () => void conversacion.abrir(unidad.titulo, { tipo: "unidad", unitId: unidad.id }),
						discutir: (attemptId) => void conversacion.abrir(`Intento sobre ${unidad.titulo}`, { tipo: "intento", attemptId }),
						guardarVolcado: (texto) => void operar("guardar-volcado", { texto }),
						paso: (p) => {
							const destino = destinoDelPaso(p, unidad.id, "unidad");
							if (destino.tipo === "tutor") void conversacion.abrir(unidad.titulo, { tipo: "unidad", unitId: unidad.id });
							else if (p.tipo === "volcado") enfocarVolcado();
							else router.push(destino.ruta);
						},
						ajustar: (cambios) => void operar("editar-unidad", cambios),
						confirmar: () => void operar("confirmar-unidad", {}),
						archivar: () => void operar("archivar-unidad", {}),
						aceptarSugerencia: () => void operar("aceptar-sugerencia", {}),
						descartarSugerencia: () => void operar("descartar-sugerencia", {}),
						moverAEspacio: (areaId) => void operar("mover-a-espacio", { areaId }),
						nuevoCuaderno: () => void nuevoCuaderno(),
						navegar: (ruta) => router.push(ruta),
					}}
				/>
			) : falta ? (
				<div className="mx-auto max-w-2xl px-6 pt-14">
					<p className="text-muted-foreground">Esta unidad no está en el espacio activo. Elige su espacio en el menú de la barra lateral o vuelve al plan.</p>
					<Button variant="link" className="h-auto p-0" onClick={() => router.push("/")}>Ir a Inicio</Button>
				</div>
			) : (
				<p className="mx-auto max-w-2xl px-6 pt-14 text-sm text-muted-foreground">Cargando…</p>
			)}
			{conversacion.dialogo}
		</div>
	);
}
