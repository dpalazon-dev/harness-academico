"use client";

/**
 * El inicio del armazón de estudio (tickets 01 y 07; ticket 04 de la segunda
 * ronda): pregunta qué quiere poder hacer David, con el cuadro de mensaje en el
 * centro y la unidad del paso propuesto como contexto, que se puede quitar.
 * Debajo, las acciones rápidas según el momento (crear plan, continuar,
 * repasar, retomar, ponerse a prueba, añadir material o contexto), como mucho
 * cinco; después, la línea de ritmo (ticket 06: cuatro cifras) y la agenda
 * (ticket 05: semana o mes con la lista de la selección). Lo pendiente de
 * decidir está en la barra lateral (ticket 02).
 * Sin grafo, sin cadenas, sin coste, sin importación de notas y sin el
 * conmutador entre enseñar y practicar (ADR 0005).
 *
 * `InicioEstudio` es pura; `Inicio` la conecta con el plugin, con la
 * configuración de modelos y con la creación de conversaciones del núcleo.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, ArrowUpIcon, PlusIcon, MessageSquarePlusIcon, RotateCwIcon, TargetIcon, Undo2Icon, UploadIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SetupDialog } from "@/components/setup-dialog";
import { openModelPicker, selectedModelUnavailable, useModelSetup } from "@/components/setup-cta";
import { OPENING_PROMPT_FAILURE } from "@/components/opening-prompt";
import { SessionStarter } from "@/components/start-session";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { cn } from "@/lib/utils";
import { llamarEstudio } from "./llamar";
import { useAbrirConversacion } from "./abrir-conversacion";
import { rutaIntento, rutaPracticar } from "./intento";
import { usePorDecidir } from "./por-decidir";
import { AgendaInicio, useDatosAgenda, type DatosAgenda, type Rango } from "./agenda";
import { LineaRitmo } from "./ritmo";
import { destinoDelPaso, rutaVolcado } from "./paso";
import { ANCLA_SUBIR, RUTA_BIBLIOTECA } from "./documentos";
import type { LecturaInicio, LecturaPlan, LecturaRitmo, PasoDeUnidad } from "./tipos";

/** Un repaso de hoy: el intento a medias, si lo hay, o la unidad. */
type Repaso = { unitId: string; intentoId: string | null };

export interface AccionesInicio {
	/** Abre una conversación nueva; con unidad, la lleva como contexto. */
	enviar(texto: string, unitId: string | null): void;
	paso(paso: PasoDeUnidad): void;
	repasar(repaso: Repaso): void;
	retomar(chatId: string): void;
	abrirUnidad(unitId: string): void;
	/** Crea el plan del espacio con su objetivo, sin pasar por el tutor. */
	crearPlan(objetivo: string): void;
	/** Abre la práctica de una unidad elegida por David, toque o no. */
	ponerAPrueba(unitId: string): void;
	/** Biblioteca, en su acción de subir una fuente. */
	anadirMaterial(): void;
	/** El campo del volcado inicial en la página de la unidad. */
	abrirVolcado(unitId: string): void;
}

export function InicioEstudio({ espacio, lectura, unidades, agenda, ritmo, ahora = new Date(), ocupado, error, acciones, porDecidir }: {
	/** Nombre del espacio activo; null con «Todos». */
	espacio: string | null;
	/** null mientras se lee. */
	lectura: LecturaInicio | null;
	/** Las unidades activas del plan, en su orden. */
	unidades: UnidadActiva[];
	/** Lo leído de la agenda y a quién avisar de los rangos que pide. */
	agenda: { datos: DatosAgenda | null; onRangos(r: { visible: Rango; seleccion: Rango }): void };
	/** La lectura `ritmo`; null mientras se lee. */
	ritmo: LecturaRitmo | null;
	ahora?: Date;
	ocupado: boolean;
	error: string | null;
	acciones: AccionesInicio;
	/** Lo que espera una decisión de David y cómo abrir su panel; sin ello no se enseña la tarjeta. */
	porDecidir?: { total: number; abrir(): void };
}) {
	const [texto, setTexto] = useState("");
	const [sinContexto, setSinContexto] = useState(false);
	/** «Añadir contexto» sin volcado pendiente: la caja invita a contar lo que David ya sabe o busca. */
	const [indicacion, setIndicacion] = useState(false);
	const caja = useRef<HTMLTextAreaElement>(null);
	const paso = lectura?.paso ?? null;
	const contexto = sinContexto || !paso ? null : { unitId: paso.unitId, titulo: paso.titulo };
	// El paso de volcado solo se propone a una unidad sin volcado (`pasoDe` en el plugin): es la señal que trae el inicio.
	const volcadoPendiente = contexto && paso?.tipo === "volcado" ? contexto.unitId : null;
	const enviar = () => {
		const t = texto.trim();
		if (t && !ocupado) acciones.enviar(t, contexto?.unitId ?? null);
	};

	return (
		<div className="relative h-dvh overflow-y-auto font-prose">
			{/* Franja para arrastrar la ventana en Electron; primera en el DOM (ver home del núcleo). */}
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			{/* HarnessAcademico (Inicio, variante B elegida por David el 24-nov-2026): el panel de hoy, caja arriba y dos columnas. */}
			<main className="mx-auto w-full max-w-[55rem] px-6 pb-24 pt-16">
				<h1 className="font-title text-3xl leading-tight">{espacio ? `Hoy en ${espacio}` : "Hoy"}</h1>
				{lectura?.plan?.objetivo && <p className="mt-1 text-muted-foreground">{lectura.plan.objetivo}</p>}
				{error && <p role="alert" className="mt-6 text-sm text-destructive">{error}</p>}
				<form
					className="mt-6 rounded-3xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] transition-shadow focus-within:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.2)]"
					onSubmit={(e) => { e.preventDefault(); enviar(); }}
				>
					<textarea
						value={texto}
						onChange={(e) => setTexto(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
								e.preventDefault();
								enviar();
							}
						}}
						ref={caja}
						rows={3}
						autoFocus
						aria-label="Mensaje al tutor"
						placeholder={indicacion ? "Cuéntale al tutor lo que ya sabes del tema o lo que buscas…" : "Explica lo que has entendido, reconstruye sin mirar o pregunta…"}
						className="lh-input w-full resize-none bg-transparent px-4 pt-4 text-[15px] outline-none placeholder:text-muted-foreground/70"
					/>
					<div className="flex items-center gap-2 px-3 pb-3">
						{contexto ? (
							<span className="inline-flex max-w-[70%] items-center gap-1 rounded-full bg-secondary py-0.5 pl-2.5 pr-1 text-xs text-secondary-foreground" data-contexto={contexto.unitId}>
								<span className="truncate">{contexto.titulo}</span>
								<button type="button" aria-label="Quitar la unidad de contexto" onClick={() => setSinContexto(true)} className="rounded-full p-0.5 hover:bg-background">
									<XIcon className="size-3" />
								</button>
							</span>
						) : <span className="text-xs text-muted-foreground">Conversación nueva, sin unidad de contexto</span>}
						<Button
							type="submit"
							size="icon"
							className="ml-auto size-8 rounded-full"
							disabled={!texto.trim() || ocupado}
							aria-label="Empezar conversación"
						>
							<ArrowUpIcon className="size-4" />
						</Button>
					</div>
				</form>

				{lectura && (
					<div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_1fr]">
						<div className="flex min-w-0 flex-col gap-3">
							<SiguientePaso lectura={lectura} ocupado={ocupado} acciones={acciones} />
							<AccionesRapidas lectura={lectura} unidades={unidades} volcadoPendiente={volcadoPendiente} enfocarCaja={() => { setIndicacion(true); caja.current?.focus(); }} ocupado={ocupado} acciones={acciones} />
						</div>
						<div className="flex min-w-0 flex-col gap-3">
							<Tarjeta titulo="Esta semana">
								<div className="mb-2"><LineaRitmo ritmo={ritmo} /></div>
								<AgendaInicio
									datos={agenda.datos}
									ahora={ahora}
									ocupado={ocupado}
									onRangos={agenda.onRangos}
									acciones={{ repasar: acciones.repasar, paso: acciones.paso, abrirUnidad: acciones.abrirUnidad, abrirConversacion: acciones.retomar }}
								/>
							</Tarjeta>
							{porDecidir && porDecidir.total > 0 && (
								<Tarjeta titulo={`Por decidir (${porDecidir.total})`}>
									<p className="text-sm text-muted-foreground">{porDecidir.total === 1 ? "Una propuesta del tutor espera tu decisión." : `${porDecidir.total} propuestas del tutor esperan tu decisión.`}</p>
									<Button variant="outline" size="sm" className="mt-2 self-start" onClick={porDecidir.abrir}>Revisar</Button>
								</Tarjeta>
							)}
						</div>
					</div>
				)}
			</main>
		</div>
	);
}

type Ficha = "crear-plan" | "continuar" | "repasar" | "retomar" | "prueba" | "material" | "contexto";
/** Una unidad activa del plan, para «Ponerme a prueba». */
export interface UnidadActiva { id: string; titulo: string }

/** Las acciones rápidas bajo la caja (ticket 04 de la segunda ronda): solo las que tocan en este momento, por orden de
 * prioridad y como mucho cinco. */
const MAX_FICHAS = 5;
/** Los repasos fijados por el regulador (de hoy o vencidos); los intentos a medias, sin fecha, no cuentan. */
const repasosFijados = (lectura: LecturaInicio) => lectura.repasos.filter(r => r.intentoId === null);

function fichasDe(lectura: LecturaInicio, unidades: UnidadActiva[]): Ficha[] {
	const fichas: Ficha[] = [];
	if (!lectura.plan) fichas.push("crear-plan");
	if (lectura.paso) fichas.push("continuar");
	if (repasosFijados(lectura).length > 0) fichas.push("repasar");
	if (lectura.abierto) fichas.push("retomar");
	if (unidades.length > 0) fichas.push("prueba");
	fichas.push("material", "contexto");
	return fichas.slice(0, MAX_FICHAS);
}

function AccionesRapidas({ lectura, unidades, volcadoPendiente, enfocarCaja, ocupado, acciones }: {
	lectura: LecturaInicio; unidades: UnidadActiva[]; ocupado: boolean; acciones: AccionesInicio;
	/** La unidad de contexto, si aún no tiene volcado; null si no hay contexto o ya lo tiene. */
	volcadoPendiente: string | null;
	enfocarCaja(): void;
}) {
	const [creandoPlan, setCreandoPlan] = useState(false);
	// El paso propuesto tiene su propia tarjeta (SiguientePaso); aquí, lo demás que toca hoy.
	const fichas = fichasDe(lectura, unidades).filter(f => f !== "continuar");
	return (
		<Tarjeta titulo="Para hoy">
			<div className="flex flex-col" role="group" aria-label="Acciones rápidas">
				{fichas.map(f => {
					switch (f) {
						case "crear-plan": return (
							<FichaBoton key={f} ficha={f} detalle="Tu objetivo en este espacio, dividido en unidades" onClick={() => setCreandoPlan(v => !v)} disabled={ocupado} aria-expanded={creandoPlan}>
								<PlusIcon className="size-3.5" />Crear plan
							</FichaBoton>
						);
						case "repasar": {
							const repasos = repasosFijados(lectura);
							return (
								<FichaBoton key={f} ficha={f} detalle="Los que tocan hoy o ya han vencido" onClick={() => acciones.repasar(repasos[0]!)} disabled={ocupado}>
									<RotateCwIcon className="size-3.5" />Repasar <small className="text-xs text-muted-foreground">({repasos.length})</small>
								</FichaBoton>
							);
						}
						case "retomar": {
							const abierto = lectura.abierto!;
							const pendiente = [...abierto.abierto, ...(abierto.siguiente ? [`Siguiente: ${abierto.siguiente}`] : [])].join("\n");
							return (
								<FichaBoton key={f} ficha={f} title={pendiente || undefined} detalle={abierto.abierto[0] ?? (abierto.siguiente ? `Siguiente: ${abierto.siguiente}` : undefined)} onClick={() => acciones.retomar(abierto.chatId)} disabled={ocupado}>
									<Undo2Icon className="size-3.5 shrink-0" />Retomar
									<small className="min-w-0 truncate text-xs text-muted-foreground">«{abierto.titulo}»</small>
								</FichaBoton>
							);
						}
						case "prueba": return (
							<DropdownMenu key={f}>
								<DropdownMenuTrigger asChild disabled={ocupado}>
									<FichaBoton ficha={f} detalle="Elige una unidad del plan"><TargetIcon className="size-3.5" />Ponerme a prueba</FichaBoton>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start" className="max-h-72 max-w-xs font-prose">
									<DropdownMenuLabel className="text-xs text-muted-foreground">Practicar una unidad</DropdownMenuLabel>
									{unidades.map(u => (
										<DropdownMenuItem key={u.id} onSelect={() => acciones.ponerAPrueba(u.id)}><span className="truncate">{u.titulo}</span></DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						);
						case "material": return (
							<FichaBoton key={f} ficha={f} detalle="Sube un PDF o un apunte a la biblioteca" onClick={acciones.anadirMaterial} disabled={ocupado}>
								<UploadIcon className="size-3.5" />Añadir material
							</FichaBoton>
						);
						case "contexto": return (
							<FichaBoton key={f} ficha={f} detalle="Cuéntale al tutor lo que ya sabes del tema" onClick={() => volcadoPendiente ? acciones.abrirVolcado(volcadoPendiente) : enfocarCaja()} disabled={ocupado}>
								<MessageSquarePlusIcon className="size-3.5" />Añadir contexto
							</FichaBoton>
						);
					}
				})}
			</div>
			{creandoPlan && !lectura.plan && <NuevoPlan ocupado={ocupado} crear={acciones.crearPlan} />}
		</Tarjeta>
	);
}

/** Una tarjeta del panel de hoy: título pequeño y su contenido. */
function Tarjeta({ titulo, children }: { titulo: string; children: React.ReactNode }) {
	return (
		<section aria-label={titulo} className="flex min-w-0 flex-col rounded-2xl bg-card px-4 py-3.5">
			<h2 className="mb-2 text-sm font-medium text-muted-foreground">{titulo}</h2>
			{children}
		</section>
	);
}

/** «Siguiente paso» (variante B): qué toca ahora, su porqué y un solo botón principal; «Otra cosa» despliega los demás
 * pasos propuestos del plan. Sin paso, la tarjeta no aparece. */
function SiguientePaso({ lectura, ocupado, acciones }: { lectura: LecturaInicio; ocupado: boolean; acciones: AccionesInicio }) {
	const [otros, setOtros] = useState(false);
	const paso = lectura.paso;
	if (!paso) return null;
	const demas = lectura.pasos.filter(p => !(p.unitId === paso.unitId && p.tipo === paso.tipo));
	return (
		<Tarjeta titulo="Siguiente paso">
			<p className="text-lg font-semibold leading-snug">{paso.accion} · {paso.titulo}</p>
			<p className="mt-1 text-sm text-muted-foreground">{paso.motivo}</p>
			<div className="mt-3 flex flex-wrap gap-2">
				<Button size="sm" data-ficha="continuar" data-destacada="true" title={paso.motivo} onClick={() => acciones.paso(paso)} disabled={ocupado}>
					<ArrowRightIcon />{paso.boton || "Empezar"}
				</Button>
				{demas.length > 0 && (
					<Button size="sm" variant="outline" aria-expanded={otros} onClick={() => setOtros(v => !v)}>Otra cosa</Button>
				)}
			</div>
			{otros && (
				<ul className="mt-3 flex flex-col" aria-label="Otros pasos propuestos">
					{demas.map(p => (
						<li key={`${p.unitId}-${p.tipo}`}>
							<button type="button" onClick={() => acciones.paso(p)} disabled={ocupado} className="flex w-full min-w-0 flex-col items-start rounded-lg px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
								<span className="truncate font-medium">{p.accion} · {p.titulo}</span>
								<span className="line-clamp-1 text-sm text-muted-foreground">{p.motivo}</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</Tarjeta>
	);
}

/** Una acción de «Para hoy» (variante B): fila con la acción y su motivo a la vista. */
function FichaBoton({ ficha, destacada, detalle, children, className, ...props }: React.ComponentProps<"button"> & { ficha: Ficha; destacada?: boolean; detalle?: string }) {
	return (
		<button
			type="button"
			{...props}
			data-ficha={ficha}
			data-destacada={destacada || undefined}
			className={cn(
				"flex w-full min-w-0 flex-col items-start rounded-lg px-2 py-1.5 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60",
				className,
			)}
		>
			<span className="flex w-full min-w-0 items-center gap-1.5 font-medium">{children}</span>
			{detalle && <span className="line-clamp-2 text-sm text-muted-foreground">{detalle}</span>}
		</button>
	);
}


/** Crear el plan del espacio a mano, como en la Ruta de la vista antigua (ticket 11): solo el objetivo; las unidades
 * llegan después, propuestas por el tutor o creadas con ⌘K. Se despliega con la ficha «Crear plan». */
function NuevoPlan({ ocupado, crear }: { ocupado: boolean; crear(objetivo: string): void }) {
	const [objetivo, setObjetivo] = useState("");
	const valido = objetivo.trim() !== "";
	return (
		<form
			className="mx-auto mt-3 flex max-w-xl gap-2"
			data-testid="nuevo-plan"
			onSubmit={(e) => { e.preventDefault(); if (valido && !ocupado) crear(objetivo.trim()); }}
		>
			<input
				aria-label="Objetivo del plan"
				autoFocus
				placeholder="Objetivo del plan: qué quieres poder hacer al final"
				value={objetivo}
				onChange={(e) => setObjetivo(e.target.value)}
				disabled={ocupado}
				className="lh-input h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground"
			/>
			<Button type="submit" size="sm" variant="secondary" disabled={ocupado || !valido}>Crear plan</Button>
		</form>
	);
}

export function Inicio({ initialConfigured }: { initialConfigured: boolean }) {
	const router = useRouter();
	const conversacion = useAbrirConversacion(initialConfigured);
	const [espacio, setEspacio] = useState<string | null>(null);
	const [lectura, setLectura] = useState<LecturaInicio | null>(null);
	const [unidades, setUnidades] = useState<UnidadActiva[]>([]);
	const [ritmo, setRitmo] = useState<LecturaRitmo | null>(null);
	const [ocupado, setOcupado] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [configurar, setConfigurar] = useState(false);
	const starter = useRef(new SessionStarter());
	const agenda = useDatosAgenda();
	const porDecidir = usePorDecidir();
	const refrescarAgenda = agenda.refrescar;
	const { catalog, configured, zeroKeys } = useModelSetup(initialConfigured);

	/** Solo pinta la lectura más reciente: los avisos del plugin y las operaciones leen a la vez. */
	const ultima = useRef(0);
	const leer = useCallback(() => {
		const esta = ++ultima.current;
		llamarEstudio<{ areas: { id: string; name: string }[]; activeAreaId: string | null }>("espacios")
			.then(v => { if (esta === ultima.current) setEspacio(v.areas.find(a => a.id === v.activeAreaId)?.name ?? null); })
			.catch(() => { if (esta === ultima.current) setEspacio(null); });
		// Las unidades activas del plan, para «Ponerme a prueba»; si su lectura falla, la ficha no se ofrece.
		llamarEstudio<LecturaPlan>("plan")
			.then(p => { if (esta === ultima.current) setUnidades(p.unidades.filter(u => !u.propuesta && !u.fueraDelPlan).map(u => ({ id: u.id, titulo: u.titulo }))); })
			.catch(() => { if (esta === ultima.current) setUnidades([]); });
		// Si el ritmo no se puede leer, la línea queda vacía: no tapa el inicio con un error.
		llamarEstudio<LecturaRitmo>("ritmo")
			.then(r => { if (esta === ultima.current) setRitmo(r); })
			.catch(() => { if (esta === ultima.current) setRitmo(null); });
		llamarEstudio<LecturaInicio>("inicio")
			.then(l => { if (esta === ultima.current) setLectura(l); })
			.catch((e: unknown) => { if (esta === ultima.current) setError(e instanceof Error ? e.message : "No se pudo leer el inicio."); });
		refrescarAgenda();
	}, [refrescarAgenda]);
	useEffect(leer, [leer]);
	// Cambiar de espacio en la barra lateral, o cualquier cambio en Estudio, avisa por el canal del plugin.
	useServerEvent("plugin-message", (m) => { if (m.pluginId === "estudio") leer(); });
	useServerResync(leer);

	const enviar = async (texto: string, unitId: string | null) => {
		// Las mismas guardas que el inicio del núcleo: sin modelos o sin clave no
		// se crea la conversación (quedaría huérfana); el borrador se conserva.
		if (!configured || zeroKeys) { setConfigurar(true); return; }
		const strong = catalog?.slots.strong?.model;
		if (selectedModelUnavailable(catalog, strong ? `${strong.provider}:${strong.id}` : undefined)) { openModelPicker(); return; }
		setOcupado(true);
		setError(null);
		try {
			const cuerpo = unitId ? { title: texto, studyContext: { tipo: "unidad" as const, unitId } } : { title: texto };
			router.push(await starter.current.start(cuerpo, fetch, JSON.stringify(catalog?.slots.strong)));
		} catch {
			setOcupado(false);
			setError(OPENING_PROMPT_FAILURE);
		}
	};

	/** Crear el plan: la operación del plugin y, después, la lectura de nuevo. */
	const crearPlan = async (objetivo: string) => {
		setOcupado(true);
		setError(null);
		try { await llamarEstudio("crear-plan", { goal: objetivo }); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear el plan."); }
		leer();
		setOcupado(false);
	};

	return (
		<>
			<InicioEstudio
				espacio={espacio}
				lectura={lectura}
				unidades={unidades}
				agenda={agenda}
				ritmo={ritmo}
				ocupado={ocupado || conversacion.abriendo}
				error={error ?? conversacion.error ?? agenda.error}
				porDecidir={{ total: porDecidir.total, abrir: porDecidir.abrir }}
				acciones={{
					enviar: (t, u) => void enviar(t, u),
					paso: (p) => {
						const destino = destinoDelPaso(p, p.unitId, "inicio");
						if (destino.tipo === "tutor") void conversacion.abrir(p.titulo, { tipo: "unidad", unitId: p.unitId });
						else router.push(destino.ruta);
					},
					repasar: (r) => router.push(r.intentoId ? rutaIntento(r.intentoId, { volver: "/" }) : rutaPracticar(r.unitId, { volver: "/" })),
					retomar: (chatId) => router.push(`/chat/${chatId}`),
					abrirUnidad: (id) => router.push(`/unidad/${id}`),
					crearPlan: (objetivo) => void crearPlan(objetivo),
					ponerAPrueba: (unitId) => router.push(rutaPracticar(unitId, { volver: "/" })),
					anadirMaterial: () => router.push(`${RUTA_BIBLIOTECA}#${ANCLA_SUBIR}`),
					abrirVolcado: (unitId) => router.push(rutaVolcado(unitId)),
				}}
			/>
			{porDecidir.panel}
			<SetupDialog open={configurar} onClose={() => setConfigurar(false)} onDone={() => setConfigurar(false)} />
			{conversacion.dialogo}
		</>
	);
}
