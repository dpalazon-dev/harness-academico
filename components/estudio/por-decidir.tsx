"use client";

/**
 * «Por decidir» (ticket 02 de la segunda ronda; spec, historia 17): lo que espera la decisión de David, fuera del
 * inicio. La barra lateral lo cuenta y abre este panel desde cualquier pantalla del armazón; sus tarjetas son las que
 * pintaba la bandeja del inicio, con las mismas operaciones del plugin, que ejecuta `BarraLateral`.
 *
 * `ListaPorDecidir` es pura, para el render estático; `PanelPorDecidir` la pone en el panel lateral del núcleo
 * (`Sheet`, sobre el diálogo de Radix), que se cierra con Escape, con su botón o pulsando fuera. `usePorDecidir`
 * conecta ambos con el plugin para la barra.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { llamarEstudio } from "./llamar";
import { ErrorDeLectura } from "./error-lectura";
import type { LecturaPorDecidir } from "./tipos";
import { rutaPlan } from "./plan";

export type PlanPropuesto = LecturaPorDecidir["planes"][number];
export type Sugerencia = LecturaPorDecidir["sugerencias"][number];

export interface AccionesPorDecidir {
	abrirUnidad(unitId: string): void;
	abrirPlan(planId: string): void;
	aceptarPlan(p: PlanPropuesto): void;
	descartarPlan(p: PlanPropuesto): void;
	aceptarSugerencia(s: Sugerencia): void;
	descartarSugerencia(s: Sugerencia): void;
	aplicarCambio(id: string): void;
	rechazarCambio(id: string): void;
	confirmarBorrador(id: string): void;
	descartarBorrador(id: string): void;
}

/** Cuántas decisiones esperan; sin lectura, ninguna. */
export const totalPorDecidir = (l: LecturaPorDecidir | null): number =>
	l ? l.planes.length + l.cambios.length + l.sugerencias.length + l.borradores.length : 0;

const BORRADOR = { hecho: "Hecho", pregunta: "Pregunta", sintesis: "Síntesis" } as const;

export function ListaPorDecidir({ lectura, ocupado, error, errorLectura = false, reintentar, acciones }: {
	/** null mientras se lee. */
	lectura: LecturaPorDecidir | null;
	ocupado: boolean;
	/** El error de la última decisión, si falló. */
	error: string | null;
	/** La última lectura falló; si había una anterior, se sigue enseñando debajo. */
	errorLectura?: boolean;
	reintentar?(): void;
	acciones: AccionesPorDecidir;
}) {
	return (
		<div className="space-y-3">
			{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
			{errorLectura && <ErrorDeLectura que="lo pendiente de decidir" reintentar={reintentar} />}
			{!lectura && !error && !errorLectura && <p className="text-sm text-muted-foreground">Cargando…</p>}
			{lectura && (totalPorDecidir(lectura) === 0 ? (
				<p className="text-sm text-muted-foreground">Nada pendiente de tu decisión.</p>
			) : (
				<ul className="space-y-2">
					{lectura.planes.map(p => (
						<Decision key={p.id} ocupado={ocupado} confirmarTexto="Aceptar" confirmar={() => acciones.aceptarPlan(p)} descartar={() => acciones.descartarPlan(p)}>
							<p className="text-xs text-muted-foreground">Plan propuesto por el tutor · {p.elementos === 1 ? "1 elemento" : `${p.elementos} elementos`}</p>
							<button type="button" onClick={() => acciones.abrirPlan(p.id)} className="anillo-foco text-left font-medium hover:underline">{p.objetivo}</button>
						</Decision>
					))}
					{lectura.cambios.map(c => (
						<Decision key={c.id} ocupado={ocupado} confirmarTexto="Aplicar" descartarTexto={c.caducado ? "Descartar" : "Rechazar"}
							confirmar={c.caducado ? undefined : () => acciones.aplicarCambio(c.id)} descartar={() => acciones.rechazarCambio(c.id)}>
							<p className="text-xs text-muted-foreground">
								Cambio del plan <button type="button" onClick={() => acciones.abrirPlan(c.planId)} className="hover:underline">«{c.objetivo}»</button>
							</p>
							{c.descripcion.map(d => <p key={d}>{d}</p>)}
							{c.motivo && <p className="text-muted-foreground">{c.motivo}</p>}
							{c.caducado && <p className="text-destructive">Ya no se puede aplicar: {c.caducado}.</p>}
						</Decision>
					))}
					{lectura.sugerencias.map(x => (
						<Decision key={x.unitId} ocupado={ocupado} confirmarTexto="Aceptar" confirmar={() => acciones.aceptarSugerencia(x)} descartar={() => acciones.descartarSugerencia(x)}>
							<p className="text-xs text-muted-foreground">
								Capacidad y criterio para <button type="button" onClick={() => acciones.abrirUnidad(x.unitId)} className="hover:underline">«{x.titulo}»</button>
							</p>
							<p>{x.capacidad}</p>
							<p className="text-muted-foreground">Sabrás que puedes cuando: {x.criterio}</p>
						</Decision>
					))}
					{lectura.borradores.map(b => (
						<Decision key={b.id} ocupado={ocupado} confirmar={() => acciones.confirmarBorrador(b.id)} descartar={() => acciones.descartarBorrador(b.id)}>
							<p className="text-xs text-muted-foreground">{BORRADOR[b.tipo]} sin confirmar{b.origen === "tutor" ? ", del tutor" : ""}</p>
							<p>{b.resumen}</p>
						</Decision>
					))}
				</ul>
			))}
		</div>
	);
}

function Decision({ children, ocupado, confirmar, descartar, confirmarTexto = "Confirmar", descartarTexto = "Descartar" }: {
	children: React.ReactNode; ocupado: boolean;
	/** Sin él, solo se puede descartar. */
	confirmar?: () => void; descartar(): void; confirmarTexto?: string; descartarTexto?: string;
}) {
	return (
		<li className="space-y-1 rounded-lg border border-border p-3 text-sm">
			{children}
			<div className="flex gap-1 pt-1">
				{confirmar && <Button size="sm" variant="secondary" disabled={ocupado} onClick={confirmar}>{confirmarTexto}</Button>}
				<Button size="sm" variant="ghost" disabled={ocupado} onClick={descartar}>{descartarTexto}</Button>
			</div>
		</li>
	);
}

/** El panel lateral, a la derecha, con la lista. */
export function PanelPorDecidir({ abierto, onAbierto, ...lista }: React.ComponentProps<typeof ListaPorDecidir> & {
	abierto: boolean;
	onAbierto(abierto: boolean): void;
}) {
	return (
		<Sheet open={abierto} onOpenChange={onAbierto}>
			<SheetContent
				side="right"
				showCloseButton={false}
				className="gap-0 font-prose sm:max-w-md"
				data-testid="panel-por-decidir"
				onCloseAutoFocus={(e) => {
					// Sin nada pendiente, el elemento que lo abrió ya no está en la barra: el foco va a Inicio, justo encima.
					if (document.querySelector("[data-testid='por-decidir']")) return;
					e.preventDefault();
					document.querySelector<HTMLElement>("[data-testid='inicio']")?.focus();
				}}
			>
				<SheetHeader className="flex-row items-start justify-between gap-2 border-b border-border">
					<div className="space-y-1">
						<SheetTitle className="font-title text-xl font-normal">Por decidir</SheetTitle>
						<SheetDescription>Nada cambia en tu plan ni en tu base de conocimiento sin que lo confirmes.</SheetDescription>
					</div>
					<SheetClose asChild>
						<Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label="Cerrar">
							<XIcon className="size-4" />
						</Button>
					</SheetClose>
				</SheetHeader>
				<div className="flex-1 overflow-y-auto p-4">
					<ListaPorDecidir {...lista} />
				</div>
			</SheetContent>
		</Sheet>
	);
}

/** Lo pendiente conectado con el plugin: lo lee al montar, al cambiar de pantalla y con cada aviso de Estudio,
 * descarta las lecturas que llegan tarde y ejecuta cada decisión con su operación de siempre, de una en una. */
export function usePorDecidir() {
	const ruta = usePathname();
	const router = useRouter();
	const [lectura, setLectura] = useState<LecturaPorDecidir | null>(null);
	const [abierto, setAbierto] = useState(false);
	const [ocupado, setOcupado] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [errorLectura, setErrorLectura] = useState(false);
	const ultima = useRef(0);
	const enCurso = useRef(false);

	// Si la lectura falla, la anterior se queda (mejor algo viejo que nada) y el panel lo dice con «Reintentar».
	const leer = useCallback(async () => {
		const esta = ++ultima.current;
		try {
			const l = await llamarEstudio<LecturaPorDecidir>("por-decidir");
			if (esta !== ultima.current) return;
			setLectura(l);
			setErrorLectura(false);
		} catch {
			if (esta === ultima.current) setErrorLectura(true);
		}
	}, []);
	const reintentar = () => { setErrorLectura(false); void leer(); };
	useEffect(() => { void leer(); }, [leer, ruta]);
	useServerEvent("plugin-message", (m) => { if (m.pluginId === "estudio") void leer(); });
	useServerResync(() => void leer());

	/** Una decisión: la operación del plugin y, después, la lectura de nuevo; el error queda en el panel. */
	const decidir = (operar: () => Promise<unknown>) => {
		if (enCurso.current) return;
		enCurso.current = true;
		setOcupado(true);
		setError(null);
		void (async () => {
			try {
				await operar();
			} catch (e) {
				setError(e instanceof Error ? e.message : "No se pudo completar la decisión.");
			}
			await leer();
			enCurso.current = false;
			setOcupado(false);
		})();
	};

	const acciones: AccionesPorDecidir = {
		abrirUnidad: (id) => { setAbierto(false); router.push(`/unidad/${id}`); },
		abrirPlan: (id) => { setAbierto(false); router.push(rutaPlan(id)); },
		aceptarPlan: (p) => decidir(() => llamarEstudio("aceptar-plan", { id: p.id, expectedRevision: p.revision })),
		descartarPlan: (p) => decidir(() => llamarEstudio("descartar-plan", { id: p.id, expectedRevision: p.revision })),
		aceptarSugerencia: (x) => decidir(() => llamarEstudio("aceptar-sugerencia", { id: x.unitId, expectedRevision: x.revision })),
		descartarSugerencia: (x) => decidir(() => llamarEstudio("descartar-sugerencia", { id: x.unitId, expectedRevision: x.revision })),
		aplicarCambio: (id) => decidir(() => llamarEstudio("aplicar-propuesta", { id })),
		rechazarCambio: (id) => decidir(() => llamarEstudio("rechazar-propuesta", { id })),
		confirmarBorrador: (id) => decidir(() => llamarEstudio("kb-confirmar", { draftIds: [id] })),
		descartarBorrador: (id) => decidir(() => llamarEstudio("kb-descartar", { draftId: id })),
	};
	return {
		total: totalPorDecidir(lectura),
		abrir: () => { if (!enCurso.current) setError(null); if (errorLectura) reintentar(); setAbierto(true); },
		panel: <PanelPorDecidir abierto={abierto} onAbierto={setAbierto} lectura={lectura} ocupado={ocupado} error={error} errorLectura={errorLectura} reintentar={reintentar} acciones={acciones} />,
	};
}
