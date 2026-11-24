"use client";

/**
 * Piezas del panel de hoy (Inicio, variante B elegida por David el 24-nov-2026), fieles a la maqueta
 * `maquetas/inicio-tipografia-chat.html`: tira de la semana con puntos, lista compacta «Para hoy» y las propuestas de
 * «Por decidir» una a una. Todo a la vista sin desplazarse; el mes entero se abre aparte.
 */
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { isoLocal, lunesDe, sumar, type DatosAgenda, type Rango } from "./agenda";
import type { LecturaPorDecidir } from "./tipos";

const LETRAS = ["L", "M", "X", "J", "V", "S", "D"] as const;

/** La semana de hoy, de lunes a domingo, con un punto en los días con actividad hecha y un anillo en hoy. Pide a la
 * agenda solo esa semana. */
export function TiraSemana({ datos, error, reintentar, ahora = new Date(), onRangos }: {
	datos: DatosAgenda | null;
	error?: string | null;
	reintentar?(): void;
	ahora?: Date;
	onRangos(r: { visible: Rango; seleccion: Rango }): void;
}) {
	const hoy = datos?.hoy ?? isoLocal(ahora);
	const lunes = lunesDe(hoy);
	const avisar = useRef(onRangos);
	avisar.current = onRangos;
	useEffect(() => {
		const semana = { desde: lunes, hasta: sumar(lunes, 6) };
		avisar.current({ visible: semana, seleccion: semana });
	}, [lunes]);
	if (error) {
		return (
			<p role="alert" data-error-lectura="" className="text-sm text-error">
				No se pudo leer la agenda.{" "}
				{reintentar && <button type="button" onClick={reintentar} className="anillo-foco rounded-sm underline underline-offset-2">Reintentar</button>}
			</p>
		);
	}
	return (
		<ol className="flex justify-between gap-1.5" aria-label="Esta semana" data-tira-semana="">
			{LETRAS.map((letra, i) => {
				const dia = sumar(lunes, i);
				const d = datos?.dias[dia];
				const hecho = (d?.hecho.length ?? 0) > 0;
				const pendiente = (d?.pendientes.length ?? 0) > 0;
				const esHoy = dia === hoy;
				return (
					<li
						key={dia}
						data-dia={dia}
						data-hoy={esHoy || undefined}
						aria-current={esHoy ? "date" : undefined}
						className={cn("flex flex-1 flex-col items-center rounded-lg py-1.5 text-xs text-muted-foreground", esHoy && "bg-background shadow-[inset_0_0_0_1.5px_var(--lh-accent)]")}
					>
						{letra}
						<b className="text-base font-semibold text-foreground">{Number(dia.slice(8))}</b>
						<span
							aria-label={hecho ? "Con actividad" : pendiente ? "Con algo pendiente" : undefined}
							className={cn("mt-0.5 size-1.5 rounded-full", hecho ? "bg-success" : pendiente && dia >= hoy ? "bg-muted-foreground" : "bg-transparent")}
						/>
					</li>
				);
			})}
		</ol>
	);
}

/** Una fila de «Para hoy»: punto de color, la acción y, a la derecha, su estado. */
export function FilaHoy({ color, texto, estado, onClick, disabled, ...datos }: {
	color: "aviso" | "acento" | "neutro";
	texto: string;
	estado?: string;
	onClick(): void;
	disabled?: boolean;
	title?: string;
	"data-ficha"?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			{...datos}
			className="anillo-foco flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent disabled:opacity-60"
		>
			<span aria-hidden className={cn("size-2 shrink-0 rounded-full", color === "aviso" ? "bg-warning" : color === "acento" ? "bg-[var(--lh-accent)]" : "bg-muted-foreground")} />
			<span className="min-w-0 flex-1 truncate">{texto}</span>
			{estado && <span className="shrink-0 text-xs text-muted-foreground">{estado}</span>}
		</button>
	);
}

/** Las propuestas que esperan decisión, una por fila; como mucho cuatro y «y N más». */
export function elementosPorDecidir(l: LecturaPorDecidir | null): string[] {
	if (!l) return [];
	return [
		...l.sugerencias.map(s => `Unidad propuesta: «${s.titulo}»`),
		...l.planes.map(p => `Plan propuesto: «${p.objetivo}»`),
		...l.cambios.map(c => c.descripcion[0] ? `Cambio en «${c.objetivo}»: ${c.descripcion[0]}` : `Cambio en «${c.objetivo}»`),
		...l.borradores.map(b => `${b.tipo === "hecho" ? "Hecho" : b.tipo === "pregunta" ? "Pregunta" : "Síntesis"} sin confirmar${b.origen === "tutor" ? " del tutor" : ""}: ${b.resumen}`),
	];
}

export function ListaPorDecidirHoy({ lectura, abrir }: { lectura: LecturaPorDecidir | null; abrir(): void }) {
	const todos = elementosPorDecidir(lectura);
	const vistos = todos.slice(0, 4);
	return (
		<ul className="flex flex-col" data-por-decidir-hoy="">
			{vistos.map((t, i) => (
				<li key={i}>
					<button type="button" onClick={abrir} className="anillo-foco w-full min-w-0 truncate rounded-lg px-2 py-1.5 text-left hover:bg-accent">{t}</button>
				</li>
			))}
			{todos.length > vistos.length && (
				<li><button type="button" onClick={abrir} className="anillo-foco rounded-lg px-2 py-1.5 text-sm text-muted-foreground underline underline-offset-2">y {todos.length - vistos.length} más</button></li>
			)}
		</ul>
	);
}
