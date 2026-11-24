"use client";

/**
 * Piezas del panel de hoy (Inicio, variante B elegida por David el 24-nov-2026), fieles a la maqueta
 * `maquetas/inicio-tipografia-chat.html`: lista compacta «Para hoy» y las propuestas de «Por decidir» una a una.
 */
import { cn } from "@/lib/utils";
import type { LecturaPorDecidir } from "./tipos";

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

export function ListaPorDecidirHoy({ lectura, abrir, compacta = false }: { lectura: LecturaPorDecidir | null; abrir(): void; compacta?: boolean }) {
	const todos = elementosPorDecidir(lectura);
	const vistos = todos.slice(0, 4);
	return (
		<ul className="flex flex-col" data-por-decidir-hoy="">
			{vistos.map((t, i) => (
				<li key={i}>
					<button type="button" onClick={abrir} className={`anillo-foco w-full min-w-0 truncate rounded-lg px-2 py-1.5 text-left hover:bg-accent${compacta ? " text-sm" : ""}`}>{t}</button>
				</li>
			))}
			{todos.length > vistos.length && (
				<li><button type="button" onClick={abrir} className="anillo-foco rounded-lg px-2 py-1.5 text-sm text-muted-foreground underline underline-offset-2">y {todos.length - vistos.length} más</button></li>
			)}
		</ul>
	);
}
