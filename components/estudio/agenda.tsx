"use client";

/**
 * La agenda del inicio (ticket 05 de la segunda ronda; spec, historias 10 a 16):
 * una tarjeta con el calendario de shadcn, que abre en la semana actual con hoy
 * seleccionado y se despliega al mes, y debajo la lista de la selección (hoy, un
 * día, los próximos 7 días o un rango). Los días pasados se pintan en tres
 * intensidades de verde según lo hecho, los que tienen repasos llevan un punto
 * de acento y hoy un contorno; la leyenda es gráfica.
 *
 * `AgendaInicio` es pura: recibe lo leído y avisa de qué rangos necesita;
 * `useDatosAgenda` los lee con la operación `agenda` de Estudio.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ComponentType } from "react";
import { BookOpenIcon, ChevronDownIcon, ChevronUpIcon, NotebookPenIcon, PenLineIcon, RotateCwIcon } from "lucide-react";
import { Week, getDefaultClassNames, type DayButtonProps, type WeekProps } from "react-day-picker";
import { es } from "react-day-picker/locale";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { llamarEstudio } from "./llamar";
import { ErrorDeLectura } from "./error-lectura";
import type { DiaAgenda, HechoAgenda, LecturaAgenda, PasoDeUnidad, PendienteAgenda, Tarea } from "./tipos";

export type RepasoAgenda = Extract<PendienteAgenda, { tipo: "repaso" }>;

export interface AccionesAgenda {
	/** Un repaso de hoy (o vencido, o el intento a medias): a la pantalla de intento. */
	repasar(r: RepasoAgenda): void;
	paso(p: PasoDeUnidad): void;
	abrirUnidad(unitId: string): void;
	abrirConversacion(chatId: string): void;
}

export interface Rango { desde: string; hasta: string }
/** Lo que se ha leído: los días con algo, por fecha; un día ausente no tiene nada. */
export interface DatosAgenda { hoy: string; dias: Record<string, DiaAgenda> }
export interface EstadoAgenda {
	vista: "semana" | "mes";
	seleccion: Rango;
	/** Primer día del mes que muestra el calendario desplegado. */
	mes: string;
	/** «Elegir rango»: falta el primer día o el último. */
	eligiendo: "inicio" | "fin" | null;
}

/** Como la operación: un rango elegido a mano no pasa de un año. */
const MAX_DIAS = 366;

// Fechas locales en AAAA-MM-DD, la forma de la operación.
const dos = (n: number) => String(n).padStart(2, "0");
export const isoLocal = (d: Date) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const fechaLocal = (dia: string) => { const [a, m, d] = dia.split("-").map(Number); return new Date(a!, m! - 1, d!); };
const sumar = (dia: string, n: number) => { const f = fechaLocal(dia); f.setDate(f.getDate() + n); return isoLocal(f); };
const lunesDe = (dia: string) => sumar(dia, -((fechaLocal(dia).getDay() + 6) % 7));
const primeroDeMes = (dia: string) => `${dia.slice(0, 8)}01`;
const ultimoDeMes = (mes: string) => { const f = fechaLocal(mes); return isoLocal(new Date(f.getFullYear(), f.getMonth() + 1, 0)); };
const diasEntre = (desde: string, hasta: string) => Math.round((fechaLocal(hasta).getTime() - fechaLocal(desde).getTime()) / 86_400_000);
function* dias({ desde, hasta }: Rango) { for (let d = desde; d <= hasta; d = sumar(d, 1)) yield d; }

/** Lo que pinta el calendario: la semana de hoy o las semanas completas del mes, como las muestra el calendario. */
export function rangoVisible(estado: EstadoAgenda, hoy: string): Rango {
	if (estado.vista === "semana") { const l = lunesDe(hoy); return { desde: l, hasta: sumar(l, 6) }; }
	return { desde: lunesDe(estado.mes), hasta: sumar(lunesDe(ultimoDeMes(estado.mes)), 6) };
}

const estadoInicial = (hoy: string): EstadoAgenda => ({ vista: "semana", seleccion: { desde: hoy, hasta: hoy }, mes: primeroDeMes(hoy), eligiendo: null });

/** Intensidad de lo hecho un día: 1, 2 o 3 cosas o más. La comparte el gráfico anual de Progreso. */
export const nivelDeActividad = (n: number) => Math.min(3, n);
const nivel = (d: DiaAgenda | undefined) => nivelDeActividad(d?.hecho.length ?? 0);
export const VERDE = ["", "bg-[color-mix(in_oklab,var(--lh-success)_25%,transparent)]", "bg-[color-mix(in_oklab,var(--lh-success)_55%,transparent)]", "bg-[color-mix(in_oklab,var(--lh-success)_90%,transparent)]"];
const tieneRepaso = (d: DiaAgenda | undefined) => !!d?.pendientes.some(p => p.tipo === "repaso");

const nombreDia = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** Un día del calendario: el botón de shadcn con la intensidad, el punto de repaso y el contorno de hoy. */
function BotonDia({ className, children, day, modifiers, ...props }: DayButtonProps) {
	const n = modifiers.act3 ? 3 : modifiers.act2 ? 2 : modifiers.act1 ? 1 : 0;
	const marcas = [modifiers.today && "hoy", modifiers.selected && "seleccionado", n > 0 && `actividad ${n} de 3`, modifiers.repaso && "con repasos"].filter(Boolean).join(", ");
	return (
		<CalendarDayButton
			{...props}
			day={day}
			modifiers={modifiers}
			data-dia={isoLocal(day.date)}
			data-actividad={n || undefined}
			data-repaso={modifiers.repaso || undefined}
			data-hoy={modifiers.today || undefined}
			aria-label={`${nombreDia.format(day.date)}${marcas ? `, ${marcas}` : ""}`}
			className={cn(className, "relative aspect-auto h-(--cell-size)", VERDE[n], modifiers.today && "ring-1 ring-inset ring-[var(--lh-accent)]")}
		>
			{children}
			{modifiers.repaso && <span aria-hidden="true" className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-[var(--lh-accent)]" />}
		</CalendarDayButton>
	);
}

/** Plegada, la agenda solo pinta la semana que empieza este lunes; desplegada, null. */
const SemanaPlegada = createContext<string | null>(null);

/** Una fila del calendario: plegado, solo la de la semana de hoy (dentro del mes de hoy, siempre está). Fuera del
 * render, como `BotonDia`: un componente nuevo en cada render rehace el calendario. El tipo de DayPicker no admite
 * null, pero React sí: la fila no se pinta. */
function FilaSemana(props: WeekProps) {
	const lunes = useContext(SemanaPlegada);
	if (lunes !== null && !props.week.days.some(d => isoLocal(d.date) === lunes)) return null as unknown as React.JSX.Element;
	return <Week {...props} />;
}
const COMPONENTES = { DayButton: BotonDia, Week: FilaSemana };

export function AgendaInicio({ datos, error, reintentar, ahora = new Date(), ocupado, acciones, inicial, onRangos }: {
	/** null mientras se lee por primera vez. */
	datos: DatosAgenda | null;
	/** La última lectura falló: la lista lo dice en lugar de quedarse leyendo. */
	error?: string | null;
	reintentar?(): void;
	ahora?: Date;
	ocupado: boolean;
	acciones: AccionesAgenda;
	/** Solo para pintar un estado concreto; por defecto, la semana actual con hoy seleccionado. */
	inicial?: Partial<EstadoAgenda>;
	/** Lo que hay que leer: lo visible en el calendario y la selección. */
	onRangos(r: { visible: Rango; seleccion: Rango }): void;
}) {
	const hoy = datos?.hoy ?? isoLocal(ahora);
	const [estado, setEstado] = useState<EstadoAgenda>(() => ({ ...estadoInicial(hoy), ...inicial }));
	const visible = rangoVisible(estado, hoy);
	const { seleccion } = estado;

	const avisar = useRef(onRangos);
	avisar.current = onRangos;
	// Solo cuando cambian las fechas: `visible` y `seleccion` son objetos nuevos en cada render.
	const [vd, vh, sd, sh] = [visible.desde, visible.hasta, seleccion.desde, seleccion.hasta];
	useEffect(() => { avisar.current({ visible: { desde: vd, hasta: vh }, seleccion: { desde: sd, hasta: sh } }); }, [vd, vh, sd, sh]);

	const elegir = (dia: string) => setEstado(e => {
		if (e.eligiendo === "fin") {
			const [desde, hasta] = dia < e.seleccion.desde ? [dia, e.seleccion.desde] : [e.seleccion.desde, dia];
			return { ...e, eligiendo: null, seleccion: { desde, hasta: diasEntre(desde, hasta) >= MAX_DIAS ? sumar(desde, MAX_DIAS - 1) : hasta } };
		}
		return { ...e, eligiendo: e.eligiendo === "inicio" ? "fin" : null, seleccion: { desde: dia, hasta: dia } };
	});
	const seleccionar = (s: Rango) => setEstado(e => ({ ...e, eligiendo: null, seleccion: s }));
	const esHoy = seleccion.desde === hoy && seleccion.hasta === hoy;
	const esSiete = seleccion.desde === hoy && seleccion.hasta === sumar(hoy, 6);

	const delVisible = [...dias(visible)].map(d => [d, datos?.dias[d]] as const);
	const fechas = (f: (d: string, x: DiaAgenda | undefined) => boolean) => delVisible.filter(([d, x]) => f(d, x)).map(([d]) => fechaLocal(d));
	const pasado = (d: string) => d < hoy;
	const lunes = lunesDe(hoy);
	const semana = estado.vista === "semana";
	const pordefecto = getDefaultClassNames();

	return (
		<SemanaPlegada.Provider value={semana ? lunes : null}>
			<section aria-label="Agenda" className="mt-4 rounded-2xl border border-border bg-card p-3" data-agenda={estado.vista}>
				<Calendar
					mode="range"
					selected={{ from: fechaLocal(seleccion.desde), to: fechaLocal(seleccion.hasta) }}
					onSelect={() => {}}
					onDayClick={d => elegir(isoLocal(d))}
					month={fechaLocal(semana ? primeroDeMes(hoy) : estado.mes)}
					onMonthChange={m => setEstado(e => ({ ...e, mes: isoLocal(new Date(m.getFullYear(), m.getMonth(), 1)) }))}
					today={fechaLocal(hoy)}
					hideNavigation={semana}
				// Plegada, los días de otras semanas no se pintan; ocultos, el foco de las flechas no va a ellos.
				hidden={semana ? [{ before: fechaLocal(lunes) }, { after: fechaLocal(sumar(lunes, 6)) }] : undefined}
					locale={es}
					weekStartsOn={1}
					className="w-full bg-transparent p-0 [--cell-size:--spacing(9)]"
					classNames={{
						root: cn("w-full", pordefecto.root),
						day: cn("relative w-full p-0 text-center select-none group/day", pordefecto.day),
						today: cn("rounded-md", pordefecto.today),
						caption_label: cn("select-none text-sm font-medium first-letter:uppercase", pordefecto.caption_label),
					}}
					modifiers={{
						act1: fechas((d, x) => pasado(d) && nivel(x) === 1),
						act2: fechas((d, x) => pasado(d) && nivel(x) === 2),
						act3: fechas((d, x) => pasado(d) && nivel(x) === 3),
						repaso: fechas((d, x) => d >= hoy && tieneRepaso(x)),
					}}
					components={COMPONENTES}
				/>
				<div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Selección">
					<Atajo activo={esHoy} onClick={() => seleccionar({ desde: hoy, hasta: hoy })}>Hoy</Atajo>
					<Atajo activo={esSiete} onClick={() => seleccionar({ desde: hoy, hasta: sumar(hoy, 6) })}>Próximos 7 días</Atajo>
					<Atajo activo={estado.eligiendo !== null} onClick={() => setEstado(e => ({ ...e, vista: "mes", eligiendo: "inicio" }))}>
						{estado.eligiendo === "inicio" ? "Elige el primer día…" : estado.eligiendo === "fin" ? "Elige el último día…" : "Elegir rango"}
					</Atajo>
					<button
						type="button"
						onClick={() => setEstado(e => ({ ...e, vista: e.vista === "semana" ? "mes" : "semana", mes: primeroDeMes(hoy), eligiendo: null }))}
						className="anillo-foco ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
					>
						{semana ? <><ChevronDownIcon className="size-3.5" />Ver el mes</> : <><ChevronUpIcon className="size-3.5" />Ver solo esta semana</>}
					</button>
				</div>
				<Leyenda />
				<ListaAgenda datos={datos} error={error ?? null} reintentar={reintentar} hoy={hoy} seleccion={seleccion} ocupado={ocupado} acciones={acciones} />
			</section>
		</SemanaPlegada.Provider>
	);
}

function Atajo({ activo, children, onClick }: { activo: boolean; children: React.ReactNode; onClick(): void }) {
	return (
		<button
			type="button"
			aria-pressed={activo}
			onClick={onClick}
			className={cn("anillo-foco rounded-full border border-border px-2.5 py-0.5 text-xs transition-colors hover:border-primary", activo && "border-primary bg-primary text-primary-foreground")}
		>
			{children}
		</button>
	);
}

/** Escala de actividad, punto de repaso y recuadro de hoy, sin frases. */
function Leyenda() {
	return (
		<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" data-agenda="leyenda">
			<span className="inline-flex items-center gap-1">
				menos
				{[1, 2, 3].map(n => <span key={n} aria-hidden="true" data-nivel={n} className={cn("size-2.5 rounded-[3px]", VERDE[n])} />)}
				más
			</span>
			<span className="inline-flex items-center gap-1"><span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--lh-accent)]" />repaso</span>
			<span className="inline-flex items-center gap-1"><span aria-hidden="true" className="size-2.5 rounded-[3px] ring-1 ring-inset ring-[var(--lh-accent)]" />hoy</span>
		</div>
	);
}

// ---------- la lista de la selección ----------

type TipoActividad = "repaso" | "reconstruir" | "volcado" | "estudiar";
const ACTIVIDAD: Record<TipoActividad, { nombre: string; Icono: ComponentType<{ className?: string }>; color: string }> = {
	repaso: { nombre: "Repaso", Icono: RotateCwIcon, color: "#d97757" },
	reconstruir: { nombre: "Reconstruir", Icono: PenLineIcon, color: "#c08a2e" },
	volcado: { nombre: "Volcado", Icono: NotebookPenIcon, color: "#4f7fd6" },
	estudiar: { nombre: "Estudiar", Icono: BookOpenIcon, color: "#3f9a72" },
};
const DEL_PASO: Record<PasoDeUnidad["tipo"], TipoActividad> = { repasar: "repaso", reconstruir: "reconstruir", volcado: "volcado", tutor: "estudiar", decidir: "estudiar" };
/** Qué hacer, en lenguaje llano, según la tarea que fija el regulador. */
export const QUE_HACER: Record<Tarea, string> = {
	guiada: "recuperar con preguntas guía", libre: "recuperar sin mirar", estructural: "explicar la estructura con tus palabras",
	aplicada: "aplicar a un caso", comparacion: "distinguir de lo que se parece", transferencia: "llevarlo a un caso nuevo",
};
const minuscula = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

interface Elemento { clave: string; actividad: TipoActividad; unidad: string | null; titulo: string; detalle: string; vencido: number; motivo?: string; ir(): void }

function dePendiente(p: PendienteAgenda, dia: string, hoy: string, acciones: AccionesAgenda): Elemento {
	if (p.tipo === "paso") {
		return { clave: `paso-${p.unitId}`, actividad: DEL_PASO[p.paso.tipo], unidad: p.unitId, titulo: p.titulo, detalle: minuscula(p.paso.accion), vencido: 0, motivo: p.paso.motivo, ir: () => acciones.paso(p.paso) };
	}
	return {
		clave: `repaso-${p.intentoId ?? p.unitId}`, actividad: "repaso", unidad: p.unitId, titulo: p.titulo,
		detalle: p.intentoId ? "retomar el intento a medias" : QUE_HACER[p.tarea], vencido: p.vencidoDias,
		// Un repaso de otro día no se hace hoy: lleva a la unidad.
		ir: () => (dia === hoy ? acciones.repasar(p) : acciones.abrirUnidad(p.unitId)),
	};
}

function deHecho(h: HechoAgenda, i: number, acciones: AccionesAgenda): Elemento {
	const base = { clave: `${h.tipo}-${i}`, unidad: h.unitId, titulo: h.titulo, vencido: 0 };
	switch (h.tipo) {
		case "intento": return { ...base, actividad: "repaso", detalle: `hiciste un intento: ${QUE_HACER[h.tarea]}`, ir: () => acciones.abrirUnidad(h.unitId) };
		case "volcado": return { ...base, actividad: "volcado", detalle: "escribiste lo que ya sabías", ir: () => acciones.abrirUnidad(h.unitId) };
		case "fuente-trabajada": return { ...base, actividad: "estudiar", detalle: "trabajaste una fuente", ir: () => acciones.abrirUnidad(h.unitId) };
		case "cierre-bloque": return { ...base, actividad: "reconstruir", detalle: "cerraste un bloque reconstruyendo sin mirar", ir: () => acciones.abrirUnidad(h.unitId) };
		case "conversacion": return { ...base, actividad: "estudiar", detalle: "hablaste con el tutor", ir: () => acciones.abrirConversacion(h.chatId) };
	}
}

const fechaLarga = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "short" });
const fechaCorta = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" });
const diaSemana = new Intl.DateTimeFormat("es-ES", { weekday: "short" });
const sinPunto = (t: string) => t.replace(".", "");
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function ListaAgenda({ datos, error, reintentar, hoy, seleccion, ocupado, acciones }: {
	datos: DatosAgenda | null; error: string | null; reintentar?: () => void; hoy: string; seleccion: Rango; ocupado: boolean; acciones: AccionesAgenda;
}) {
	const unDia = seleccion.desde === seleccion.hasta;
	// Cada día dice lo suyo: lo hecho si pasó; hoy, lo pendiente (en un rango, solo sus repasos); después, sus repasos.
	const filas = [...dias(seleccion)].map(dia => {
		const d = datos?.dias[dia];
		const elementos = !d ? [] : dia < hoy ? d.hecho.map((h, i) => deHecho(h, i, acciones))
			: d.pendientes.filter(p => (unDia && dia === hoy) || p.tipo === "repaso").map(p => dePendiente(p, dia, hoy, acciones));
		return { dia, elementos };
	}).filter(f => f.elementos.length > 0);

	const repasos = filas.filter(f => f.dia >= hoy).flatMap(f => f.elementos.filter(e => e.actividad === "repaso"));
	const resumen = unDia && seleccion.desde === hoy ? plural(filas[0]?.elementos.length ?? 0, "pendiente", "pendientes")
		: unDia && seleccion.desde < hoy ? (filas[0] ? plural(filas[0].elementos.length, "cosa hecha", "cosas hechas") : "")
		: repasos.length > 0 ? `${plural(repasos.length, "repaso", "repasos")} · ${plural(new Set(repasos.map(r => r.unidad)).size, "unidad", "unidades")}` : "";
	const vacio = unDia && seleccion.desde < hoy ? "No estudiaste este día."
		: unDia && seleccion.desde === hoy ? "Nada pendiente para hoy."
		: seleccion.hasta < hoy ? "No estudiaste en estas fechas." : "Nada planificado en estas fechas.";

	return (
		<div data-agenda="lista" aria-busy={datos === null && !error} className="mt-3 border-t border-border pt-2">
			<div className="flex items-baseline justify-between gap-3 px-2 pb-1.5 pt-1">
				<h2 className="text-sm font-semibold">
					{unDia ? mayuscula(sinPunto(fechaLarga.format(fechaLocal(seleccion.desde)))) : `${sinPunto(fechaCorta.format(fechaLocal(seleccion.desde)))} – ${sinPunto(fechaCorta.format(fechaLocal(seleccion.hasta)))}`}
				</h2>
				{resumen && <small className="shrink-0 text-xs text-muted-foreground">{resumen}</small>}
			</div>
			{/* Con datos de antes, la lista se queda y el aviso va encima: puede que ya no esté al día. */}
			{error && <ErrorDeLectura que="la agenda" reintentar={reintentar} className="px-2 py-1.5" />}
			{datos === null ? (!error && <p className="px-2 py-1.5 text-sm text-muted-foreground">Leyendo la agenda…</p>)
				: filas.length === 0 ? <p className="px-2 py-1.5 text-sm text-muted-foreground">{vacio}</p>
				: (
					<ol>
						{filas.map(f => (
							<li key={f.dia} data-dia-lista={f.dia} className="grid grid-cols-[44px_1fr] items-start gap-3 border-t border-border px-2 py-2 first:border-t-0">
								<div className={cn("flex flex-col items-center leading-tight", f.dia === hoy && "text-[var(--lh-accent)]")}>
									<span className={cn("text-[11px] uppercase tracking-[0.06em]", f.dia !== hoy && "text-muted-foreground")}>{f.dia === hoy ? "hoy" : sinPunto(diaSemana.format(fechaLocal(f.dia)))}</span>
									<b className="text-lg">{fechaLocal(f.dia).getDate()}</b>
								</div>
								<ul className="flex min-w-0 flex-col gap-0.5">
									{f.elementos.map(e => <li key={e.clave}><FilaElemento e={e} ocupado={ocupado} /></li>)}
								</ul>
							</li>
						))}
					</ol>
				)}
		</div>
	);
}

function FilaElemento({ e, ocupado }: { e: Elemento; ocupado: boolean }) {
	const { nombre, Icono, color } = ACTIVIDAD[e.actividad];
	return (
		<button
			type="button"
			onClick={e.ir}
			disabled={ocupado}
			title={e.motivo}
			data-actividad-tipo={e.actividad}
			className="anillo-foco -ml-2 flex w-full items-start gap-2.5 rounded-md px-2 py-1 text-left text-sm hover:bg-accent disabled:opacity-60"
		>
			<span className="inline-flex w-28 shrink-0 items-center gap-1.5 pt-px text-xs font-semibold" style={{ color }}>
				<span className="inline-flex size-5 items-center justify-center rounded-md" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
					<Icono className="size-3.5" />
				</span>
				{nombre}
			</span>
			<span className="min-w-0 flex-1">
				{e.titulo}
				<span className="block text-xs text-muted-foreground">
					{e.detalle}
					{e.vencido > 0 && <span className="text-[var(--lh-accent)]"> · vencido hace {e.vencido} d</span>}
				</span>
			</span>
		</button>
	);
}

/** Lee la agenda de lo visible y de la selección; `refrescar` vuelve a leer lo último pedido. */
export function useDatosAgenda() {
	const [datos, setDatos] = useState<DatosAgenda | null>(null);
	const [error, setError] = useState<string | null>(null);
	const rangos = useRef<Rango[]>([]);
	const ultima = useRef(0);
	const refrescar = useCallback(() => {
		const pedidos = rangos.current;
		if (pedidos.length === 0) return;
		const esta = ++ultima.current;
		Promise.all(pedidos.map(r => llamarEstudio<LecturaAgenda>("agenda", r)))
			.then(lecturas => {
				if (esta !== ultima.current) return;
				const porDia: Record<string, DiaAgenda> = {};
				for (const l of lecturas) for (const d of l.dias) porDia[d.dia] = d;
				setDatos({ hoy: lecturas[0]!.hoy, dias: porDia });
				setError(null);
			})
			.catch((e: unknown) => { if (esta === ultima.current) setError(e instanceof Error ? e.message : "No se pudo leer la agenda."); });
	}, []);
	const onRangos = useCallback(({ visible, seleccion }: { visible: Rango; seleccion: Rango }) => {
		const dentro = seleccion.desde >= visible.desde && seleccion.hasta <= visible.hasta;
		rangos.current = dentro ? [visible] : [visible, seleccion];
		refrescar();
	}, [refrescar]);
	return { datos, error, onRangos, refrescar };
}
