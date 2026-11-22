/** Los cuatro grupos del ciclo (GLOSSARY.md) y su marca: cuatro segmentos finos, sin orden obligatorio. */
import { cn } from "@/lib/utils";
import type { CicloUnidad, EstadoGrupo } from "./tipos";

export const GRUPOS: { id: keyof CicloUnidad; nombre: string }[] = [
	{ id: "orientar", nombre: "Orientar" },
	{ id: "exponer", nombre: "Exponer y capturar" },
	{ id: "reconstruir", nombre: "Reconstruir y contrastar" },
	{ id: "mantener", nombre: "Mantener y usar" },
];

export const TEXTO_ESTADO: Record<EstadoGrupo, string> = { hecho: "Hecho", pendiente: "Pendiente", vacio: "Sin empezar" };
export const TONO_ESTADO: Record<EstadoGrupo, string> = { hecho: "bg-[var(--lh-success)]", pendiente: "bg-[var(--lh-warning)]", vacio: "bg-border" };

export function BarraCiclo({ ciclo, className }: { ciclo: CicloUnidad; className?: string }) {
	const texto = GRUPOS.map(g => `${g.nombre}: ${TEXTO_ESTADO[ciclo[g.id]]}`).join(", ");
	return (
		<span role="img" data-ciclo="barra" aria-label={texto} title={texto} className={cn("flex gap-0.5", className)}>
			{GRUPOS.map(g => <span key={g.id} className={cn("h-1 flex-1 rounded-full", TONO_ESTADO[ciclo[g.id]])} />)}
		</span>
	);
}
