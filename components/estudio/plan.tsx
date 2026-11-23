"use client";

/**
 * La página de un plan (spec `.scratch/planes`): un objetivo con una lista plana de temas, tareas e hitos. David lo
 * edita directamente (añadir, renombrar, marcar, mover, quitar, fecha de un hito); un plan que propuso el tutor se
 * acepta o se descarta entero, y los cambios que el tutor propone a uno aceptado se aplican o se rechazan aquí.
 * «Trabajar» convierte un tema en unidad, con su título; un tema con unidad la abre.
 *
 * `PaginaPlanEstudio` es pura; `PaginaPlan` la conecta con el plugin.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownIcon, ArrowRightIcon, ArrowUpIcon, BookOpenIcon, FlagIcon, ListTodoIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { cn } from "@/lib/utils";
import { BarraCiclo } from "./ciclo";
import { cambiarPlan, llamarEstudio, type CambioDelPlan } from "./llamar";
import type { ElementoPlan, LecturaPlanes, PlanLeido, TipoElemento } from "./tipos";

export const rutaPlan = (id: string) => `/plan/${id}`;

export const TIPO_ELEMENTO: Record<TipoElemento, { nombre: string; icono: typeof BookOpenIcon }> = {
	tema: { nombre: "Tema", icono: BookOpenIcon },
	tarea: { nombre: "Tarea", icono: ListTodoIcon },
	hito: { nombre: "Hito", icono: FlagIcon },
};

export interface AccionesPlan {
	cambiar(...ops: CambioDelPlan[]): void;
	editarObjetivo(objetivo: string): void;
	aceptar(): void;
	descartar(): void;
	archivar(): void;
	trabajar(elementoId: string): void;
	aplicarCambio(id: string): void;
	rechazarCambio(id: string): void;
	/** Lleva el plan, con las unidades de sus temas, a otro espacio; null lo deja sin espacio. */
	moverAEspacio(areaId: string | null): void;
	navegar(ruta: string): void;
}

const fechaLarga = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const fechaHito = (dia: string) => fechaLarga.format(new Date(`${dia}T00:00:00Z`));

export function PaginaPlanEstudio({ plan: p, espacios = null, ocupado, error, acciones }: {
	plan: PlanLeido;
	/** Los espacios no archivados a los que se puede llevar el plan; null mientras cargan. */
	espacios?: { id: string; name: string }[] | null;
	ocupado: boolean;
	error: string | null;
	acciones: AccionesPlan;
}) {
	const propuesto = p.estado === "propuesto";
	return (
		<article className="mx-auto w-full max-w-2xl px-6 pb-24 pt-14">
			<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
				<span>{propuesto ? "Plan propuesto por el tutor" : "Plan"}</span>
				<span aria-label={`${p.hechos} de ${p.total} hechos`}>· {p.hechos}/{p.total}</span>
			</div>
			<Objetivo key={p.objetivo} objetivo={p.objetivo} ocupado={ocupado} guardar={acciones.editarObjetivo} />

			{error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}

			{propuesto && (
				<div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl bg-accent/60 p-4" data-testid="plan-propuesto">
					<p className="flex-1 text-sm">El tutor propuso este plan. Puedes retocarlo antes; nada cuenta hasta que lo aceptes.</p>
					<Button size="sm" disabled={ocupado} onClick={acciones.aceptar}>Aceptar</Button>
					<Button size="sm" variant="ghost" disabled={ocupado} onClick={acciones.descartar}>Descartar</Button>
				</div>
			)}

			{p.cambios.length > 0 && (
				<ul className="mt-6 space-y-2" aria-label="Cambios propuestos por el tutor">
					{p.cambios.map(c => (
						<li key={c.id} className="space-y-1 rounded-lg border border-border p-3 text-sm">
							<p className="text-xs text-muted-foreground">Cambio propuesto por el tutor</p>
							{c.descripcion.map(d => <p key={d}>{d}</p>)}
							{c.motivo && <p className="text-muted-foreground">{c.motivo}</p>}
							{c.caducado && <p className="text-destructive">Ya no se puede aplicar: {c.caducado}.</p>}
							<div className="flex gap-1 pt-1">
								{!c.caducado && <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => acciones.aplicarCambio(c.id)}>Aplicar</Button>}
								<Button size="sm" variant="ghost" disabled={ocupado} onClick={() => acciones.rechazarCambio(c.id)}>{c.caducado ? "Descartar" : "Rechazar"}</Button>
							</div>
						</li>
					))}
				</ul>
			)}

			<ol className="mt-8 divide-y divide-border border-y border-border" aria-label="Elementos del plan">
				{p.elementos.length === 0 && <li className="py-4 text-sm text-muted-foreground">El plan aún no tiene elementos. Añade el primero abajo o pídeselo al tutor.</li>}
				{p.elementos.map((e, i) => (
					<FilaElemento
						key={e.id} elemento={e} primero={i === 0} ultimo={i === p.elementos.length - 1} indice={i}
						ocupado={ocupado} propuesto={propuesto} acciones={acciones}
					/>
				))}
			</ol>

			<NuevoElemento ocupado={ocupado} anadir={(op) => acciones.cambiar(op)} />

			{!propuesto && (
				<div className="mt-10 flex flex-wrap items-center gap-2 text-sm">
					{espacios && espacios.length > 0 && (
						<label className="flex items-center gap-2 text-muted-foreground">
							Llevar a
							<select
								aria-label="Llevar el plan a otro espacio"
								disabled={ocupado}
								value=""
								onChange={(ev) => { if (ev.target.value) acciones.moverAEspacio(ev.target.value === "-" ? null : ev.target.value); }}
								className="lh-input rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
							>
								<option value="">Elige un espacio…</option>
								{espacios.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
								<option value="-">Sin espacio</option>
							</select>
						</label>
					)}
					<Button size="sm" variant="ghost" disabled={ocupado} onClick={acciones.archivar}>Archivar el plan</Button>
				</div>
			)}
		</article>
	);
}

function Objetivo({ objetivo, ocupado, guardar }: { objetivo: string; ocupado: boolean; guardar(objetivo: string): void }) {
	const [texto, setTexto] = useState(objetivo);
	const confirmar = () => { const t = texto.trim(); if (t && t !== objetivo) guardar(t); else setTexto(objetivo); };
	return (
		<textarea
			aria-label="Objetivo del plan"
			value={texto}
			disabled={ocupado}
			rows={1}
			onChange={(e) => setTexto(e.target.value)}
			onBlur={confirmar}
			onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } if (e.key === "Escape") setTexto(objetivo); }}
			className="mt-3 field-sizing-content w-full resize-none bg-transparent font-title text-4xl tracking-tight outline-none"
		/>
	);
}

function FilaElemento({ elemento: e, indice, primero, ultimo, ocupado, propuesto, acciones }: {
	elemento: ElementoPlan; indice: number; primero: boolean; ultimo: boolean; ocupado: boolean; propuesto: boolean; acciones: AccionesPlan;
}) {
	const { nombre, icono: Icono } = TIPO_ELEMENTO[e.tipo];
	const [titulo, setTitulo] = useState(e.titulo);
	useEffect(() => setTitulo(e.titulo), [e.titulo]);
	const renombrar = () => { const t = titulo.trim(); if (t && t !== e.titulo) acciones.cambiar({ op: "edit", elementoId: e.id, titulo: t }); else setTitulo(e.titulo); };
	return (
		<li className="group flex flex-wrap items-center gap-2 py-2" data-elemento={e.tipo}>
			<input
				type="checkbox"
				checked={e.hecho}
				disabled={ocupado}
				aria-label={`${e.hecho ? "Desmarcar" : "Marcar"} «${e.titulo}» como hecho`}
				onChange={() => acciones.cambiar({ op: "edit", elementoId: e.id, hecho: !e.hecho })}
				className="size-4 shrink-0 accent-primary"
			/>
			<Icono aria-label={nombre} className="size-4 shrink-0 text-muted-foreground" />
			<input
				aria-label={`Título del ${nombre.toLowerCase()}`}
				value={titulo}
				disabled={ocupado}
				onChange={(ev) => setTitulo(ev.target.value)}
				onBlur={renombrar}
				onKeyDown={(ev) => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); if (ev.key === "Escape") setTitulo(e.titulo); }}
				className={cn("min-w-0 flex-1 bg-transparent text-sm outline-none", e.hecho && "text-muted-foreground line-through")}
			/>
			{e.tipo === "hito" && (
				<input
					type="date"
					aria-label={`Fecha de «${e.titulo}»`}
					value={e.fecha ?? ""}
					disabled={ocupado}
					onChange={(ev) => acciones.cambiar({ op: "edit", elementoId: e.id, fecha: ev.target.value || null })}
					className="lh-input rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
				/>
			)}
			{e.unidad && <BarraCiclo ciclo={e.unidad.ciclo} className="w-16" />}
			{e.tipo === "tema" && (e.unidad ? (
				<Button size="sm" variant="ghost" disabled={ocupado} onClick={() => acciones.navegar(`/unidad/${e.unidad!.id}`)}>
					Abrir unidad<ArrowRightIcon className="size-4" />
				</Button>
			) : (
				<Button size="sm" variant="ghost" disabled={ocupado || propuesto} title={propuesto ? "Acepta primero el plan" : undefined} onClick={() => acciones.trabajar(e.id)}>
					Trabajar
				</Button>
			))}
			<span className="flex items-center">
				<Button size="icon" variant="ghost" className="size-7" aria-label={`Subir «${e.titulo}»`} disabled={ocupado || primero}
					onClick={() => acciones.cambiar({ op: "move", elementoId: e.id, index: indice - 1 })}><ArrowUpIcon className="size-4" /></Button>
				<Button size="icon" variant="ghost" className="size-7" aria-label={`Bajar «${e.titulo}»`} disabled={ocupado || ultimo}
					onClick={() => acciones.cambiar({ op: "move", elementoId: e.id, index: indice + 1 })}><ArrowDownIcon className="size-4" /></Button>
				<Button size="icon" variant="ghost" className="size-7" aria-label={`Quitar «${e.titulo}»`} disabled={ocupado}
					onClick={() => acciones.cambiar({ op: "remove", elementoId: e.id })}><XIcon className="size-4" /></Button>
			</span>
		</li>
	);
}

function NuevoElemento({ ocupado, anadir }: { ocupado: boolean; anadir(op: CambioDelPlan): void }) {
	const [tipo, setTipo] = useState<TipoElemento>("tema");
	const [titulo, setTitulo] = useState("");
	const [fecha, setFecha] = useState("");
	const valido = titulo.trim() !== "";
	return (
		<form
			className="mt-3 flex flex-wrap items-center gap-2"
			data-testid="nuevo-elemento"
			onSubmit={(e) => {
				e.preventDefault();
				if (!valido) return;
				anadir({ op: "add", tipo, titulo: titulo.trim(), ...(tipo === "hito" && fecha ? { fecha } : {}) });
				setTitulo("");
				setFecha("");
			}}
		>
			<select aria-label="Tipo del elemento" value={tipo} disabled={ocupado} onChange={(e) => setTipo(e.target.value as TipoElemento)}
				className="lh-input rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground">
				{(Object.keys(TIPO_ELEMENTO) as TipoElemento[]).map(t => <option key={t} value={t}>{TIPO_ELEMENTO[t].nombre}</option>)}
			</select>
			<input aria-label="Título del elemento nuevo" value={titulo} disabled={ocupado} onChange={(e) => setTitulo(e.target.value)} placeholder="Qué aprender, qué hacer o qué hito"
				className="lh-input min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" />
			{tipo === "hito" && <input type="date" aria-label="Fecha del hito nuevo" value={fecha} disabled={ocupado} onChange={(e) => setFecha(e.target.value)}
				className="lh-input rounded-md border border-border bg-background px-1.5 py-1 text-sm text-foreground" />}
			<Button type="submit" size="sm" variant="secondary" disabled={ocupado || !valido}><PlusIcon className="size-4" />Añadir</Button>
		</form>
	);
}

/** La página conectada: lee el plan entre los del espacio activo y se refresca con los avisos del plugin. */
export function PaginaPlan({ id }: { id: string }) {
	const router = useRouter();
	const [plan, setPlan] = useState<PlanLeido | null>(null);
	const [falta, setFalta] = useState(false);
	const [ocupado, setOcupado] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [espacios, setEspacios] = useState<{ id: string; name: string; archived: boolean }[] | null>(null);
	const [activo, setActivo] = useState<string | null>(null);

	const ultima = useRef(0);
	const leer = useCallback(async () => {
		const esta = ++ultima.current;
		void llamarEstudio<{ areas: { id: string; name: string; archived: boolean }[]; activeAreaId: string | null }>("espacios")
			.then(e => { if (esta === ultima.current) { setEspacios(e.areas); setActivo(e.activeAreaId); } }, () => setEspacios(null));
		try {
			const l = await llamarEstudio<LecturaPlanes>("planes");
			if (esta !== ultima.current) return;
			const encontrado = l.planes.find(p => p.id === id) ?? null;
			setPlan(encontrado);
			setFalta(encontrado === null);
		} catch (e) {
			if (esta !== ultima.current) return;
			setPlan(null);
			setFalta(true);
			setError(e instanceof Error ? e.message : "No se pudo leer el plan.");
		}
	}, [id]);
	useEffect(() => { void leer(); }, [leer]);
	useServerEvent("plugin-message", (m) => { if (m.pluginId === "estudio") void leer(); });
	useServerResync(() => void leer());

	const operar = async (fn: (p: PlanLeido) => Promise<unknown>, despues?: (r: unknown) => void) => {
		if (!plan) return;
		setOcupado(true);
		setError(null);
		try {
			const r = await fn(plan);
			despues?.(r);
		} catch (e) {
			setError(e instanceof Error ? e.message : "No se pudo cambiar el plan.");
		}
		await leer();
		setOcupado(false);
	};

	return (
		<div className="relative h-dvh overflow-y-auto font-prose">
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			{plan ? (
				<PaginaPlanEstudio
					plan={plan}
					espacios={espacios?.filter(a => !a.archived && a.id !== activo) ?? null}
					ocupado={ocupado}
					error={error}
					acciones={{
						cambiar: (...ops) => void operar(p => cambiarPlan(p, ...ops)),
						editarObjetivo: (goal) => void operar(p => llamarEstudio("editar-plan", { id: p.id, expectedRevision: p.revision, goal })),
						aceptar: () => void operar(p => llamarEstudio("aceptar-plan", { id: p.id, expectedRevision: p.revision })),
						descartar: () => void operar(p => llamarEstudio("descartar-plan", { id: p.id, expectedRevision: p.revision }), () => router.push("/")),
						archivar: () => void operar(p => llamarEstudio("editar-plan", { id: p.id, expectedRevision: p.revision, estado: "archivado" }), () => router.push("/")),
						trabajar: (elementoId) => void operar(p => llamarEstudio<{ id: string }>("trabajar-tema", { planId: p.id, elementoId }), (u) => router.push(`/unidad/${(u as { id: string }).id}`)),
						aplicarCambio: (cambioId) => void operar(() => llamarEstudio("aplicar-propuesta", { id: cambioId })),
						rechazarCambio: (cambioId) => void operar(() => llamarEstudio("rechazar-propuesta", { id: cambioId })),
						moverAEspacio: (areaId) => void operar(p => llamarEstudio("mover-a-espacio", { kind: "plan", id: p.id, areaId })),
						navegar: (ruta) => router.push(ruta),
					}}
				/>
			) : falta ? (
				<div className="mx-auto max-w-2xl px-6 pt-14">
					{error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
					<p className="text-muted-foreground">Este plan no está en el espacio activo, o ya se archivó o descartó. Elige su espacio en el menú de la barra lateral.</p>
					<Button variant="link" className="h-auto p-0" onClick={() => router.push("/")}>Ir a Inicio</Button>
				</div>
			) : (
				<p className="mx-auto max-w-2xl px-6 pt-14 text-sm text-muted-foreground">Cargando…</p>
			)}
		</div>
	);
}
