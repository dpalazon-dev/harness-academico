"use client";

/**
 * Piezas del panel de hoy (Inicio, variante B elegida por David el 24-nov-2026), fieles a la maqueta
 * `maquetas/inicio-tipografia-chat.html`: lista compacta «Para hoy» y las propuestas de «Por decidir» una a una.
 */
import { cn } from "@/lib/utils";
import type { LecturaPorDecidir } from "./tipos";

/** Las propuestas que esperan decisión: qué es y, debajo, de qué tipo. */
export function elementosPorDecidir(l: LecturaPorDecidir | null): { titulo: string; tipo: string }[] {
	if (!l) return [];
	const borrador = { hecho: "Hecho", pregunta: "Pregunta", sintesis: "Síntesis" } as const;
	return [
		...l.sugerencias.map(s => ({ titulo: s.titulo, tipo: "Unidad que propone el tutor" })),
		...l.planes.map(p => ({ titulo: p.objetivo, tipo: "Plan que propone el tutor" })),
		...l.cambios.map(c => ({ titulo: c.descripcion[0] ?? "Cambio en el plan", tipo: `Cambio propuesto en «${c.objetivo}»` })),
		...l.borradores.map(b => ({ titulo: b.resumen, tipo: `${borrador[b.tipo]} sin confirmar${b.origen === "tutor" ? ", del tutor" : ""}` })),
	];
}

export function ListaPorDecidirHoy({ lectura, abrir, compacta = false }: { lectura: LecturaPorDecidir | null; abrir(): void; compacta?: boolean }) {
	const todos = elementosPorDecidir(lectura);
	const vistos = todos.slice(0, 4);
	return (
		<ul className="flex flex-col" data-por-decidir-hoy="">
			{vistos.map((t, i) => (
				<li key={i}>
					<button type="button" onClick={abrir} className="anillo-foco flex w-full min-w-0 flex-col items-start rounded-lg px-2 py-1.5 text-left hover:bg-accent">
						<span className={`w-full truncate${compacta ? " text-sm" : ""}`}>{t.titulo}</span>
						<span className="w-full truncate text-xs text-muted-foreground">{t.tipo}</span>
					</button>
				</li>
			))}
			{todos.length > vistos.length && (
				<li><button type="button" onClick={abrir} className="anillo-foco rounded-lg px-2 py-1.5 text-sm text-muted-foreground underline underline-offset-2">y {todos.length - vistos.length} más</button></li>
			)}
		</ul>
	);
}
