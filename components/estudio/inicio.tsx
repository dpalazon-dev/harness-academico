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
import { ActivityIcon, ArrowRightIcon, BarChart3Icon, BookOpenIcon, CalendarDaysIcon, CheckIcon, FileTextIcon, FlameIcon, GoalIcon, InboxIcon, LayersIcon, MessageCircleIcon, NotebookPenIcon, PlayIcon, PlusIcon, RotateCwIcon, SendIcon, SparklesIcon, SproutIcon, SquareCheckIcon, TargetIcon, Undo2Icon, XIcon, ZapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SetupDialog } from "@/components/setup-dialog";
import { openModelPicker, selectedModelUnavailable, useModelSetup } from "@/components/setup-cta";
import { OPENING_PROMPT_FAILURE } from "@/components/opening-prompt";
import { SessionStarter } from "@/components/start-session";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { llamarEstudio } from "./llamar";
import { useAbrirConversacion } from "./abrir-conversacion";
import { rutaIntento, rutaPracticar } from "./intento";
import { ListaPorDecidirHoy } from "./panel-hoy";
import { usePorDecidir } from "./por-decidir";
import { isoLocal, lunesDe, sumar, TARJETA_PANEL, useDatosAgenda, type DatosAgenda, type Rango } from "./agenda";
import { RUTA_CUADERNOS } from "./cuadernos";
import { destinoDelPaso, rutaVolcado } from "./paso";
import { ANCLA_SUBIR, RUTA_BIBLIOTECA } from "./documentos";
import type { DiaAgenda, HechoAgenda, LecturaInicio, LecturaPlanes, LecturaPorDecidir, LecturaRitmo, PasoDeUnidad } from "./tipos";
import { unidadesEnOrden } from "./planes";
import { rutaPlan } from "./plan";

/** Un repaso de hoy: el intento a medias, si lo hay, o la unidad. */
type Repaso = { unitId: string; intentoId: string | null };

export interface AccionesInicio {
	/** Abre una conversación nueva; con unidad, la lleva como contexto. */
	enviar(texto: string, unitId: string | null): void;
	paso(paso: PasoDeUnidad): void;
	repasar(repaso: Repaso): void;
	retomar(chatId: string): void;
	abrirUnidad(unitId: string): void;
	/** Crea un plan del espacio con su objetivo, sin pasar por el tutor, y lo abre. Un espacio admite varios. */
	crearPlan(objetivo: string): void;
	/** Abre la práctica de una unidad elegida por David, toque o no. */
	ponerAPrueba(unitId: string): void;
	/** Biblioteca, en su acción de subir una fuente. */
	anadirMaterial(): void;
	/** El campo del volcado inicial en la página de la unidad. */
	abrirVolcado(unitId: string): void;
	/** Cuadernos, desde el botón «Notas» de la caja. */
	abrirNotas?(): void;
}

export function InicioEstudio({ espacio, lectura, unidades, sinPlanes = false, agenda, ritmo, ahora = new Date(), ocupado, error, acciones, porDecidir, enfoque = null }: {
	/** Nombre del espacio activo; null con «Todos». */
	espacio: string | null;
	/** null mientras se lee. */
	lectura: LecturaInicio | null;
	/** Las unidades activas de los planes, en su orden. */
	unidades: UnidadActiva[];
	/** El espacio activo no tiene ningún plan vivo: el inicio ofrece crear uno. */
	sinPlanes?: boolean;
	/** Lo leído de la agenda y a quién avisar de los rangos que pide. */
	agenda: { datos: DatosAgenda | null; error?: string | null; refrescar?(): void; onRangos(r: { visible: Rango; seleccion: Rango }): void };
	/** La lectura `ritmo`; null mientras se lee. */
	ritmo: LecturaRitmo | null;
	ahora?: Date;
	ocupado: boolean;
	error: string | null;
	acciones: AccionesInicio;
	/** Lo que espera una decisión de David y cómo abrir su panel; sin ello no se enseña la tarjeta. */
	porDecidir?: { total: number; abrir(): void; lectura: LecturaPorDecidir | null };
	/** «Enfoque de la semana»: el objetivo del plan del espacio; null o ausente, sin tarjeta. */
	enfoque?: string | null;
}) {
	const [texto, setTexto] = useState("");
	const [sinContexto, setSinContexto] = useState(false);
	/** «Añadir contexto» sin volcado pendiente: la caja invita a contar lo que David ya sabe o busca. */
	const [indicacion, setIndicacion] = useState(false);
	const caja = useRef<HTMLTextAreaElement>(null);
	const paso = lectura?.paso ?? null;
	/** La unidad elegida con «+ Unidad»; manda sobre la del paso propuesto. */
	const [elegida, setElegida] = useState<{ unitId: string; titulo: string } | null>(null);
	const contexto = elegida ?? (sinContexto || !paso ? null : { unitId: paso.unitId, titulo: paso.titulo });
	// El paso de volcado solo se propone a una unidad sin volcado (`pasoDe` en el plugin): es la señal que trae el inicio.
	const volcadoPendiente = contexto && paso?.tipo === "volcado" ? contexto.unitId : null;
	const enviar = () => {
		const t = texto.trim();
		if (t && !ocupado) acciones.enviar(t, contexto?.unitId ?? null);
	};
	/** Una sugerencia rellena la caja con su comienzo y deja el cursor al final para completarla. */
	const sugerir = (comienzo: string) => {
		setTexto(comienzo);
		requestAnimationFrame(() => { const c = caja.current; if (c) { c.focus(); c.setSelectionRange(comienzo.length, comienzo.length); } });
	};
	// La semana de hoy, para «Esta semana», «Sesión de hoy» y «Actividad de hoy»: se pide a la agenda al montar.
	const hoy = agenda.datos?.hoy ?? isoLocal(ahora);
	const lunes = lunesDe(hoy);
	const pedirSemana = useRef(agenda.onRangos);
	pedirSemana.current = agenda.onRangos;
	useEffect(() => { const semana = { desde: lunes, hasta: sumar(lunes, 6) }; pedirSemana.current({ visible: semana, seleccion: semana }); }, [lunes]);

	const diaHoy = agenda.datos?.dias[hoy];
	return (
		<div className="relative flex h-dvh overflow-hidden font-prose">
			{/* Franja para arrastrar la ventana en Electron; primera en el DOM (ver home del núcleo). */}
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			{/* HarnessAcademico (Inicio, referencia 2 «Centro de aprendizaje», elegida por David el 24-nov-2026): réplica del
			    diseño con los datos que la app tiene. */}
			<main className="min-w-0 flex-1 overflow-y-auto px-10 pb-16 pt-14">
				<div className="mx-auto max-w-[76rem]">
					<div className="flex items-start gap-4">
						<div className="min-w-0 flex-1">
							<p className="text-base text-muted-foreground">{espacio ?? "Centro de aprendizaje"}</p>
							<h1 className="mt-1 font-title text-4xl leading-tight" suppressHydrationWarning>{saludo(ahora)}</h1>
							<p className="mt-2 text-lg text-muted-foreground">Tu cabina de estudio. Enfócate, aprende y avanza.</p>
						</div>
						<p className="mt-6 inline-flex shrink-0 items-center gap-2 rounded-xl border border-border bg-[color-mix(in_oklab,var(--background),white_60%)] px-4 py-2 text-sm dark:bg-card" suppressHydrationWarning>
							<CalendarDaysIcon className="size-4" aria-hidden />{fechaCorta(ahora)}
						</p>
					</div>
					{error && <p role="alert" className="mt-6 text-sm text-destructive">{error}</p>}

					<form
						className="mt-8 rounded-2xl border border-[color-mix(in_oklab,var(--lh-accent)_45%,var(--border))] bg-[color-mix(in_oklab,var(--background),white_60%)] shadow-[0_0_0_4px_color-mix(in_oklab,var(--lh-accent)_10%,transparent),0_8px_24px_-12px_rgba(0,0,0,0.12)] dark:bg-card"
						onSubmit={(e) => { e.preventDefault(); enviar(); }}
					>
						<div className="flex items-start gap-3 px-5 pt-5">
							<SparklesIcon className="mt-0.5 size-5 shrink-0 text-[var(--lh-accent)]" aria-hidden />
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
								rows={2}
								autoFocus
								aria-label="Mensaje al tutor"
								placeholder={indicacion ? "Cuéntale al tutor lo que ya sabes del tema o lo que buscas…" : "Pregúntale a tu tutor o captura algo para trabajar…"}
								className="lh-input min-w-0 flex-1 resize-none bg-transparent outline-none placeholder:text-muted-foreground"
							/>
						</div>
						<div className="flex flex-wrap items-center justify-end gap-2 px-4 pb-4">
							{contexto ? (
								<span className="mr-auto inline-flex max-w-[50%] items-center gap-1 rounded-full bg-secondary py-1 pl-3 pr-1.5 text-sm text-secondary-foreground" data-contexto={contexto.unitId}>
									<span className="truncate">{contexto.titulo}</span>
									<button type="button" aria-label="Quitar la unidad de contexto" onClick={() => { setElegida(null); setSinContexto(true); }} className="anillo-foco rounded-full p-0.5 hover:bg-background">
										<XIcon className="size-3" />
									</button>
								</span>
							) : unidades.length > 0 ? (
								<DropdownMenu>
									<DropdownMenuTrigger asChild disabled={ocupado}>
										<button type="button" data-elegir-unidad="" className={BOTON_CAJA}><PlusIcon className="size-4" aria-hidden />Unidad</button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="max-h-72 max-w-xs font-prose">
										<DropdownMenuLabel className="text-xs text-muted-foreground">Unidad de contexto</DropdownMenuLabel>
										{unidades.map(u => (
											<DropdownMenuItem key={u.id} onSelect={() => setElegida({ unitId: u.id, titulo: u.titulo })}><span className="truncate">{u.titulo}</span></DropdownMenuItem>
										))}
									</DropdownMenuContent>
								</DropdownMenu>
							) : <span className="mr-auto text-xs text-muted-foreground">Conversación nueva, sin unidad de contexto</span>}
							{acciones.abrirNotas && <button type="button" onClick={acciones.abrirNotas} className={BOTON_CAJA}><NotebookPenIcon className="size-4" aria-hidden />Notas</button>}
							<button type="button" onClick={acciones.anadirMaterial} className={BOTON_CAJA}><LayersIcon className="size-4" aria-hidden />Material</button>
							<span className="mx-1 h-6 w-px bg-border" aria-hidden />
							<Button type="submit" size="icon" className="size-10 rounded-full bg-[var(--lh-accent)] text-background hover:opacity-90 disabled:opacity-60" disabled={!texto.trim() || ocupado} aria-label="Empezar conversación">
								<SendIcon className="size-4" />
							</Button>
						</div>
					</form>
					<div className="mt-4 flex flex-wrap justify-center gap-2.5" role="group" aria-label="Sugerencias">
						{SUGERENCIAS.map(({ etiqueta, comienzo, Icono, color }) => (
							<button key={etiqueta} type="button" data-sugerencia="" onClick={() => sugerir(comienzo)} disabled={ocupado} className="anillo-foco inline-flex items-center gap-2 rounded-full border border-border bg-[color-mix(in_oklab,var(--background),white_60%)] px-4 py-2 text-sm hover:bg-accent dark:bg-card">
								<Icono className={cn("size-4", color)} aria-hidden />{etiqueta}
							</button>
						))}
					</div>

					{lectura && (
						<div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
							<div className="flex min-w-0 flex-col gap-6">
								<SiguientePaso lectura={lectura} sinPlanes={sinPlanes} ocupado={ocupado} acciones={acciones} />
								<SesionDeHoy lectura={lectura} unidades={unidades} hecho={diaHoy?.hecho.length ?? 0} volcadoPendiente={volcadoPendiente} enfocarCaja={() => { setIndicacion(true); caja.current?.focus(); }} ocupado={ocupado} acciones={acciones} hoy={hoy} />
							</div>
							<ActividadDeHoy dia={diaHoy} error={agenda.error} reintentar={agenda.refrescar} acciones={acciones} />
						</div>
					)}
				</div>
			</main>
			{lectura && (
				<aside aria-label="Tu progreso" className="hidden w-[24rem] shrink-0 overflow-y-auto border-l border-border bg-[color-mix(in_oklab,var(--background),white_45%)] px-6 pb-10 pt-14 lg:block dark:bg-card">
					<h2 className="text-xl font-bold">Tu progreso</h2>
					<div className="mt-5 flex flex-col gap-4">
						<ProgresoSemanal agenda={agenda.datos} lunes={lunes} hoy={hoy} />
						<div className="grid grid-cols-2 gap-4">
							<section aria-label="Racha" className={TARJETA_PANEL}>
								<h3 className="flex items-center gap-2 text-sm font-semibold"><FlameIcon className="size-4 text-warning" aria-hidden />Racha</h3>
								<p className="mt-2 text-2xl font-bold">{ritmo ? `${ritmo.racha} ${ritmo.racha === 1 ? "día" : "días"}` : "—"}</p>
								{ritmo && <p className="mt-1 text-sm text-muted-foreground">Mejor: {mejorRacha(ritmo.actividad)} {mejorRacha(ritmo.actividad) === 1 ? "día" : "días"}</p>}
							</section>
							<section aria-label="Repasos pendientes" className={TARJETA_PANEL}>
								<h3 className="flex items-center gap-2 text-sm font-semibold"><RotateCwIcon className="size-4 text-warning" aria-hidden />Repasos pendientes</h3>
								<p className="mt-2 text-2xl font-bold">{repasosFijados(lectura).length}</p>
								<p className="mt-1 text-sm text-muted-foreground">Programados para hoy</p>
							</section>
						</div>
						<EstaSemana agenda={agenda.datos} lunes={lunes} hoy={hoy} />
						<PendientesClave lectura={lectura} hoy={hoy} abrirUnidad={acciones.abrirUnidad} />
						{porDecidir && porDecidir.total > 0 && (
							<section aria-label="Por decidir" className={TARJETA_PANEL}>
								<h3 className="mb-2 flex items-center gap-2 text-base font-semibold"><InboxIcon className="size-4" aria-hidden />Por decidir ({porDecidir.total})</h3>
								<ListaPorDecidirHoy lectura={porDecidir.lectura} abrir={porDecidir.abrir} />
							</section>
						)}
						{enfoque && (
							<section aria-label="Enfoque de la semana" className="rounded-2xl border border-[color-mix(in_oklab,var(--lh-success)_30%,var(--border))] bg-success/10 p-4">
								<h3 className="flex items-center gap-2 text-base font-semibold"><SproutIcon className="size-4 text-success" aria-hidden />Enfoque de la semana</h3>
								<p className="mt-2 text-sm">{enfoque}</p>
							</section>
						)}
					</div>
				</aside>
			)}
		</div>
	);
}

const BOTON_CAJA = "anillo-foco inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm hover:bg-accent";

/** Las sugerencias bajo la caja: cada una deja en la caja el comienzo de la petición; no envían nada. */
const SUGERENCIAS = [
	{ etiqueta: "Explica un concepto", comienzo: "Explícame ", Icono: ZapIcon, color: "text-warning" },
	{ etiqueta: "Crea un plan de estudio", comienzo: "Crea un plan de estudio para ", Icono: SquareCheckIcon, color: "text-warning" },
	{ etiqueta: "Resume este material", comienzo: "Resume este material: ", Icono: FileTextIcon, color: "text-muted-foreground" },
	{ etiqueta: "Prepárame un ejercicio", comienzo: "Prepárame un ejercicio sobre ", Icono: SparklesIcon, color: "text-warning" },
] as const;

const FECHA_LARGA = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const FECHA_CORTA = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
export const fechaDe = (dia: string) => { const [a, m, d] = dia.split("-").map(Number); return new Date(a!, m! - 1, d!); };
/** «Martes, 24 de noviembre de 2026». */
export function fechaDeHoy(ahora: Date): string {
	const t = FECHA_LARGA.format(ahora);
	return t.charAt(0).toUpperCase() + t.slice(1);
}
/** «Mar, 24 de noviembre de 2026», la píldora de la cabecera. */
export function fechaCorta(ahora: Date): string {
	const t = FECHA_CORTA.format(ahora).replace(".", "");
	return t.charAt(0).toUpperCase() + t.slice(1);
}
/** El saludo según la hora. */
export function saludo(ahora: Date): string {
	const h = ahora.getHours();
	return h >= 6 && h < 14 ? "Buenos días" : h >= 14 && h < 21 ? "Buenas tardes" : "Buenas noches";
}
/** La racha más larga de días seguidos con actividad. */
export function mejorRacha(actividad: readonly { dia: string; n: number }[]): number {
	let mejor = 0, actual = 0, anterior: string | null = null;
	for (const { dia, n } of actividad) {
		if (n > 0) { actual = anterior !== null && sumar(anterior, 1) === dia ? actual + 1 : 1; anterior = dia; }
		else { actual = 0; anterior = null; }
		mejor = Math.max(mejor, actual);
	}
	return mejor;
}

/** Una unidad activa de un plan, para «Ponerme a prueba». */
export interface UnidadActiva { id: string; titulo: string }

/** Los repasos fijados por el regulador (de hoy o vencidos); los intentos a medias, sin fecha, no cuentan. */
const repasosFijados = (lectura: LecturaInicio) => lectura.repasos.filter(r => r.intentoId === null);

/** El mensaje que «Pedir un siguiente paso» manda al tutor en una conversación nueva. */
export const PEDIR_PASO = "¿Qué me propones hacer ahora?";

/** «Siguiente paso» (referencia 2): el paso propuesto con su motivo, un botón principal y «Otra cosa»; sin paso, invita a
 * pedirlo (o a crear un plan). Lleva la marca «Prioridad alta» si hay repasos vencidos. */
function SiguientePaso({ lectura, sinPlanes, ocupado, acciones }: { lectura: LecturaInicio; sinPlanes: boolean; ocupado: boolean; acciones: AccionesInicio }) {
	const [otros, setOtros] = useState(false);
	const [creandoPlan, setCreandoPlan] = useState(false);
	const paso = lectura.paso;
	const demas = paso ? lectura.pasos.filter(p => !(p.unitId === paso.unitId && p.tipo === paso.tipo)) : [];
	const urgente = paso?.tipo === "repasar";
	return (
		<section aria-label="Siguiente paso" className={cn(TARJETA_PANEL, "px-6 py-5")}>
			<div className="flex items-center gap-2.5">
				<GoalIcon className="size-5" aria-hidden />
				<h2 className="flex-1 text-lg font-bold">Siguiente paso</h2>
				{urgente && <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2.5 py-1 text-sm text-warning"><FlameIcon className="size-3.5" aria-hidden />Prioridad alta</span>}
			</div>
			<div className="mt-3 flex items-center gap-4">
				<div className="min-w-0 flex-1 pl-1">
					{paso ? <>
						<p className="text-xl font-bold leading-snug">{paso.accion} · {paso.titulo}</p>
						<p className="mt-1 text-muted-foreground">{paso.motivo}</p>
						<div className="mt-4 flex flex-wrap gap-2">
							<Button className="h-10 rounded-xl px-5" data-ficha="continuar" data-destacada="true" title={paso.motivo} onClick={() => acciones.paso(paso)} disabled={ocupado}>
								<PlayIcon className="size-4" aria-hidden />Empezar
							</Button>
							{demas.length > 0 && <Button variant="outline" className="h-10 rounded-xl px-5" aria-expanded={otros} onClick={() => setOtros(v => !v)}>Otra cosa</Button>}
						</div>
						{otros && (
							<ul className="mt-3 flex flex-col" aria-label="Otros pasos propuestos">
								{demas.map(p => (
									<li key={`${p.unitId}-${p.tipo}`}>
										<button type="button" onClick={() => acciones.paso(p)} disabled={ocupado} className="anillo-foco flex w-full min-w-0 flex-col items-start rounded-lg px-2 py-1.5 text-left hover:bg-accent">
											<span className="truncate font-medium">{p.accion} · {p.titulo}</span>
											<span className="line-clamp-1 text-sm text-muted-foreground">{p.motivo}</span>
										</button>
									</li>
								))}
							</ul>
						)}
					</> : <>
						<p className="text-xl font-bold leading-snug">No hay nada propuesto ahora</p>
						<p className="mt-1 text-muted-foreground">{sinPlanes ? "Crea un plan con tu objetivo y el tutor te propondrá por dónde empezar." : "Pídele al tutor que te proponga qué hacer, o escribe arriba lo que quieres lograr."}</p>
						<div className="mt-4 flex flex-wrap gap-2">
							{sinPlanes ? (
								<Button className="h-10 rounded-xl px-5" data-ficha="crear-plan" aria-expanded={creandoPlan} onClick={() => setCreandoPlan(v => !v)} disabled={ocupado}><PlusIcon className="size-4" aria-hidden />Crear plan</Button>
							) : (
								<Button className="h-10 rounded-xl px-5" data-pedir-paso="" onClick={() => acciones.enviar(PEDIR_PASO, null)} disabled={ocupado}><PlayIcon className="size-4" aria-hidden />Pedir un siguiente paso</Button>
							)}
						</div>
						{creandoPlan && sinPlanes && <NuevoPlan ocupado={ocupado} crear={acciones.crearPlan} />}
					</>}
				</div>
				<IlustracionDiana />
			</div>
		</section>
	);
}

/** La diana de «Siguiente paso» (referencia 2). Decorativa. */
function IlustracionDiana() {
	return (
		<svg viewBox="0 0 120 110" className="hidden h-24 w-28 shrink-0 text-[var(--lh-accent)] sm:block" aria-hidden="true">
			<circle cx="58" cy="60" r="38" fill="currentColor" opacity="0.08" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" />
			<circle cx="58" cy="60" r="25" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="2.5" />
			<circle cx="58" cy="60" r="12" fill="currentColor" opacity="0.5" />
			<path d="M58 60 L96 22" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
			<path d="M96 22 L104 14 M96 22 L100 28 M96 22 L90 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
			<path d="M18 30 l6 4 M14 52 h7 M22 92 l5 -4 M104 70 h7" stroke="var(--lh-warning)" strokeWidth="2.5" strokeLinecap="round" />
		</svg>
	);
}

/** «Sesión de hoy» (referencia 2) con lo que la app sabe de hoy: crear plan, repasos, retomar; al pie, las acciones. */
function SesionDeHoy({ lectura, unidades, hecho, volcadoPendiente, enfocarCaja, ocupado, acciones, hoy }: {
	lectura: LecturaInicio; unidades: UnidadActiva[]; hecho: number; ocupado: boolean; acciones: AccionesInicio; hoy: string;
	/** La unidad de contexto, si aún no tiene volcado; null si no hay contexto o ya lo tiene. */
	volcadoPendiente: string | null;
	enfocarCaja(): void;
}) {
	const repasos = repasosFijados(lectura);
	const abierto = lectura.abierto;
	const pendientes = repasos.length + (abierto ? 1 : 0);
	const total = pendientes + hecho;
	return (
		<section aria-label="Sesión de hoy" className={cn(TARJETA_PANEL, "px-6 py-5")}>
			<div className="flex items-center gap-2.5">
				<SquareCheckIcon className="size-5" aria-hidden />
				<h2 className="flex-1 text-lg font-bold">Sesión de hoy</h2>
				<div className="w-40 text-right text-sm text-muted-foreground">
					{hecho} de {total} hechas
					<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-success" style={{ width: total ? `${(hecho / total) * 100}%` : "0%" }} /></div>
				</div>
			</div>
			<div className="mt-3 flex flex-col" role="group" aria-label="Acciones rápidas">
				{repasos.map(r => (
					<FilaSesion key={`${r.unitId}-${r.fecha}`} data-ficha="repasar" Icono={RotateCwIcon} texto={`Repasar ${r.titulo}`} estado={r.fecha !== null && r.fecha < hoy ? "vencido" : "hoy"} onClick={() => acciones.repasar(r)} disabled={ocupado} />
				))}
				{abierto && (
					<FilaSesion
						data-ficha="retomar"
						Icono={Undo2Icon}
						texto={`Retomar «${abierto.titulo}»`}
						estado="abierta"
						title={[...abierto.abierto, ...(abierto.siguiente ? [`Siguiente: ${abierto.siguiente}`] : [])].join("\n") || undefined}
						onClick={() => acciones.retomar(abierto.chatId)}
						disabled={ocupado}
					/>
				)}
				{pendientes === 0 && <p className="px-2 py-2 text-muted-foreground">Nada pendiente para hoy.</p>}
			</div>
			<div className="mt-4 flex flex-wrap items-center gap-2">
				{unidades.length > 0 && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild disabled={ocupado}>
							<button type="button" data-ficha="prueba" className={BOTON_CAJA}><TargetIcon className="size-4" aria-hidden />Ponerme a prueba</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="max-h-72 max-w-xs font-prose">
							<DropdownMenuLabel className="text-xs text-muted-foreground">Practicar una unidad</DropdownMenuLabel>
							{unidades.map(u => (
								<DropdownMenuItem key={u.id} onSelect={() => acciones.ponerAPrueba(u.id)}><span className="truncate">{u.titulo}</span></DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
				<button type="button" data-ficha="material" onClick={acciones.anadirMaterial} disabled={ocupado} className={BOTON_CAJA}><PlusIcon className="size-4" aria-hidden />Añadir material</button>
				<button type="button" data-ficha="contexto" onClick={() => volcadoPendiente ? acciones.abrirVolcado(volcadoPendiente) : enfocarCaja()} disabled={ocupado} className={BOTON_CAJA}><SparklesIcon className="size-4" aria-hidden />Añadir contexto</button>
			</div>
		</section>
	);
}

function FilaSesion({ Icono, texto, estado, onClick, disabled, ...datos }: {
	Icono: React.ComponentType<{ className?: string }>; texto: string; estado: string; onClick(): void; disabled?: boolean; title?: string; "data-ficha"?: string;
}) {
	return (
		<button type="button" onClick={onClick} disabled={disabled} {...datos} className="anillo-foco flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent disabled:opacity-60">
			<span className="grid size-5 shrink-0 place-items-center rounded-[5px] border border-border text-muted-foreground"><Icono className="size-3" aria-hidden /></span>
			<span className="min-w-0 flex-1 truncate">{texto}</span>
			<span className="shrink-0 rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{estado}</span>
		</button>
	);
}

const HECHO: Record<HechoAgenda["tipo"], { nombre: string; Icono: React.ComponentType<{ className?: string }> }> = {
	conversacion: { nombre: "Conversación con el tutor", Icono: MessageCircleIcon },
	"fuente-trabajada": { nombre: "Lectura", Icono: BookOpenIcon },
	intento: { nombre: "Práctica", Icono: TargetIcon },
	volcado: { nombre: "Volcado", Icono: NotebookPenIcon },
	"cierre-bloque": { nombre: "Bloque cerrado", Icono: LayersIcon },
};

/** «Actividad de hoy» (referencia 2): lo hecho hoy, con tick, y lo que queda, en una línea de tiempo (sin horas: la app
 * no las guarda). */
function ActividadDeHoy({ dia, error, reintentar, acciones }: { dia: DiaAgenda | undefined; error?: string | null; reintentar?(): void; acciones: AccionesInicio }) {
	const hecho = dia?.hecho ?? [];
	const pendientes = dia?.pendientes ?? [];
	return (
		<section aria-label="Actividad de hoy" className={cn(TARJETA_PANEL, "px-6 py-5")}>
			<h2 className="flex items-center gap-2.5 text-lg font-bold"><ActivityIcon className="size-5" aria-hidden />Actividad de hoy</h2>
			{error ? (
				<p role="alert" data-error-lectura="" className="mt-3 text-sm text-error">No se pudo leer la agenda. {reintentar && <button type="button" onClick={reintentar} className="anillo-foco rounded-sm underline underline-offset-2">Reintentar</button>}</p>
			) : hecho.length + pendientes.length === 0 ? (
				<p className="mt-3 text-muted-foreground">Aún no has hecho nada hoy. Lo que hagas aparecerá aquí.</p>
			) : (
				<ol className="relative mt-4 flex flex-col gap-3 before:absolute before:bottom-4 before:left-[11px] before:top-4 before:w-px before:bg-border">
					{hecho.map((h, i) => {
						const { nombre, Icono } = HECHO[h.tipo];
						const ir = h.tipo === "conversacion" ? () => acciones.retomar(h.chatId) : () => h.unitId && acciones.abrirUnidad(h.unitId);
						return (
							<li key={`h-${i}`} className="relative flex items-center gap-3">
								<span className="z-10 grid size-6 shrink-0 place-items-center rounded-full bg-success text-background"><CheckIcon className="size-3.5" aria-hidden /></span>
								<button type="button" onClick={ir} className="anillo-foco flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left hover:bg-accent">
									<Icono className="size-4 shrink-0 text-muted-foreground" aria-hidden />
									<span className="min-w-0"><b className="block text-sm font-semibold">{nombre}</b><span className="block truncate text-sm text-muted-foreground">{h.titulo}</span></span>
								</button>
							</li>
						);
					})}
					{pendientes.map((p, i) => (
						<li key={`p-${i}`} className="relative flex items-center gap-3">
							<span className="z-10 size-6 shrink-0 rounded-full border-2 border-border bg-background" aria-hidden />
							<button type="button" onClick={() => p.tipo === "paso" ? acciones.paso(p.paso) : acciones.repasar(p)} className={cn("anillo-foco flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left hover:bg-accent", i === 0 && "bg-[color-mix(in_oklab,var(--lh-accent)_10%,transparent)]")}>
								<PlayIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
								<span className="min-w-0"><b className="block text-sm font-semibold">{i === 0 ? "Lo siguiente" : p.tipo === "repaso" ? "Repaso" : "Paso"}</b><span className="block truncate text-sm text-muted-foreground">{p.titulo}</span></span>
							</button>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

/** «Progreso semanal»: días con actividad esta semana, de siete. */
function ProgresoSemanal({ agenda, lunes, hoy }: { agenda: DatosAgenda | null; lunes: string; hoy: string }) {
	const dias = Array.from({ length: 7 }, (_, i) => sumar(lunes, i));
	const estudiados = dias.filter(d => (agenda?.dias[d]?.hecho.length ?? 0) > 0).length;
	const pct = Math.round((estudiados / 7) * 100);
	return (
		<section aria-label="Progreso semanal" className={TARJETA_PANEL}>
			<div className="flex items-center gap-2">
				<BarChart3Icon className="size-4" aria-hidden />
				<h3 className="flex-1 text-base font-semibold">Progreso semanal</h3>
				<a href="/progreso" className="anillo-foco inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground">Ver detalles <ArrowRightIcon className="size-3" aria-hidden /></a>
			</div>
			<div className="mt-3 flex items-baseline justify-between">
				<b className="text-3xl font-bold">{agenda ? `${pct} %` : "—"}</b>
				<span className="text-sm text-muted-foreground">{estudiados} de 7 días</span>
			</div>
			<div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Días estudiados esta semana">
				<div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
			</div>
			<span className="sr-only">Hoy es {hoy}</span>
		</section>
	);
}

const LETRAS = ["L", "M", "X", "J", "V", "S", "D"] as const;

/** «Esta semana» (referencia 2): siete días con un tick si se estudió, punto en hoy y círculo vacío en lo que viene. */
function EstaSemana({ agenda, lunes, hoy }: { agenda: DatosAgenda | null; lunes: string; hoy: string }) {
	return (
		<section aria-label="Esta semana" className={TARJETA_PANEL}>
			<h3 className="flex items-center gap-2 text-base font-semibold"><CalendarDaysIcon className="size-4" aria-hidden />Esta semana</h3>
			<ol className="mt-3 flex justify-between" data-tira-semana="">
				{LETRAS.map((letra, i) => {
					const dia = sumar(lunes, i);
					const hecho = (agenda?.dias[dia]?.hecho.length ?? 0) > 0;
					const esHoy = dia === hoy;
					return (
						<li key={dia} data-dia={dia} data-hoy={esHoy || undefined} aria-current={esHoy ? "date" : undefined} className={cn("flex w-10 flex-col items-center gap-0.5 rounded-xl py-1.5 text-sm", esHoy && "bg-[color-mix(in_oklab,var(--lh-accent)_10%,transparent)] shadow-[inset_0_0_0_1.5px_var(--lh-accent)]")}>
							<span className="text-xs text-muted-foreground">{letra}</span>
							<b className="font-semibold">{Number(dia.slice(8))}</b>
							{hecho ? <span className="mt-1 grid size-4 place-items-center rounded-full bg-success text-background"><CheckIcon className="size-2.5" aria-label="Estudiado" /></span>
								: esHoy ? <span className="mt-1 size-4 rounded-full bg-[var(--lh-accent)]" aria-hidden />
								: <span className="mt-1 size-4 rounded-full border-2 border-border" aria-hidden />}
						</li>
					);
				})}
			</ol>
		</section>
	);
}

const DIA_CORTO = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric" });
function etiquetaDia(dia: string, hoy: string): string {
	if (dia === hoy) return "Hoy";
	if (dia === sumar(hoy, 1)) return "Mañana";
	const t = DIA_CORTO.format(fechaDe(dia)).replace(".", "");
	return t.charAt(0).toUpperCase() + t.slice(1);
}

/** «Pendientes clave» (referencia 2): los repasos de hoy y los próximos, con su día. */
function PendientesClave({ lectura, hoy, abrirUnidad }: { lectura: LecturaInicio; hoy: string; abrirUnidad(id: string): void }) {
	const filas = [
		...repasosFijados(lectura).map(r => ({ unitId: r.unitId, titulo: r.titulo, dia: hoy })),
		...lectura.proximos.flatMap(p => p.unidades.map(u => ({ unitId: u.unitId, titulo: u.titulo, dia: p.dia }))),
	];
	if (filas.length === 0) return null;
	return (
		<section aria-label="Pendientes clave" className={TARJETA_PANEL}>
			<h3 className="mb-2 flex items-center gap-2 text-base font-semibold"><LayersIcon className="size-4" aria-hidden />Pendientes clave</h3>
			<ul className="flex flex-col">
				{filas.slice(0, 5).map(f => (
					<li key={`${f.dia}-${f.unitId}`}>
						<button type="button" onClick={() => abrirUnidad(f.unitId)} className="anillo-foco flex w-full min-w-0 items-center gap-3 rounded-lg px-1 py-1.5 text-left hover:bg-accent">
							<span className="size-4 shrink-0 rounded-full border-2 border-border" aria-hidden />
							<span className="min-w-0 flex-1 truncate text-sm">Repaso: {f.titulo}</span>
							<span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs", f.dia <= hoy ? "bg-warning/15 text-warning" : "bg-secondary text-secondary-foreground")}>{etiquetaDia(f.dia, hoy)}</span>
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}

/** Crear un plan del espacio a mano, como en la Ruta de la vista antigua (ticket 11): solo el objetivo; los elementos
 * se añaden después en su página o los propone el tutor. Se despliega con la ficha «Crear plan». */
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
	const [sinPlanes, setSinPlanes] = useState(false);
	const [enfoque, setEnfoque] = useState<string | null>(null);
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
		// Las unidades activas de los planes, para «Ponerme a prueba»; si su lectura falla, la ficha no se ofrece.
		llamarEstudio<LecturaPlanes>("planes")
			.then(p => {
				if (esta !== ultima.current) return;
				setUnidades(unidadesEnOrden(p).filter(u => !u.propuesta && u.enPlan).map(u => ({ id: u.id, titulo: u.titulo })));
				setSinPlanes(p.planes.length === 0);
				setEnfoque(p.planes.length === 1 ? p.planes[0]!.objetivo : p.planes.length > 1 ? p.planes.map(x => x.objetivo).join(" · ") : null);
			})
			.catch(() => { if (esta === ultima.current) { setUnidades([]); setSinPlanes(false); setEnfoque(null); } });
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

	/** Crear un plan: la operación del plugin y, después, su página para llenarlo. */
	const crearPlan = async (objetivo: string) => {
		setOcupado(true);
		setError(null);
		try {
			const plan = await llamarEstudio<{ id: string }>("crear-plan", { goal: objetivo });
			router.push(rutaPlan(plan.id));
		} catch (e) {
			setError(e instanceof Error ? e.message : "No se pudo crear el plan.");
			leer();
		}
		setOcupado(false);
	};

	return (
		<>
			<InicioEstudio
				espacio={espacio}
				lectura={lectura}
				unidades={unidades}
				sinPlanes={sinPlanes}
				agenda={agenda}
				ritmo={ritmo}
				ocupado={ocupado || conversacion.abriendo}
				error={error ?? conversacion.error}
				porDecidir={{ total: porDecidir.total, abrir: porDecidir.abrir, lectura: porDecidir.lectura }}
				enfoque={enfoque}
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
					abrirNotas: () => router.push(RUTA_CUADERNOS),
				}}
			/>
			{porDecidir.panel}
			<SetupDialog open={configurar} onClose={() => setConfigurar(false)} onDone={() => setConfigurar(false)} />
			{conversacion.dialogo}
		</>
	);
}
