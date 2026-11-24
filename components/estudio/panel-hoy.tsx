"use client";

/**
 * Piezas del panel de hoy (Inicio, variante B elegida por David el 24-nov-2026), fieles a la maqueta
 * `maquetas/inicio-tipografia-chat.html`: lista compacta «Para hoy» y las propuestas de «Por decidir» una a una.
 */
import { cn } from "@/lib/utils";
import type { LecturaPorDecidir } from "./tipos";

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
