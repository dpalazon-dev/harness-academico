"use client";

import { Check, ChevronRight, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { BrailleSpinner } from "@/components/braille-spinner";
import { cabeceraActividad, fallida, textoPasos, type ParteConTipo } from "@/components/actividad";
import { cn } from "@/lib/utils";

/**
 * El bloque plegado de actividad de un turno (diseño 2B). Cerrado por
 * defecto: mientras el tutor trabaja, la cabecera dice el paso en curso;
 * al terminar, un resumen en una línea. Dentro, cada herramienta con su
 * tarjeta de siempre (entrada y salida plegadas).
 */
export function ActividadTurno({
	partes,
	turnoVivo,
	children,
}: {
	partes: readonly (ParteConTipo & { errorText?: unknown })[];
	/** Este bloque es el último del turno en curso: su herramienta activa es el paso actual. */
	turnoVivo: boolean;
	children: ReactNode;
}) {
	const [abierto, setAbierto] = useState(false);
	const { enCurso, texto, pasos } = cabeceraActividad(partes, turnoVivo);
	const fallos = partes.filter(p => p.type.startsWith("tool-") && fallida(p)).length;
	return (
		<Collapsible open={abierto} onOpenChange={setAbierto} className="my-1 w-full max-w-2xl" data-testid="actividad-turno">
			<CollapsibleTrigger
				className={cn(
					"group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left font-ui text-xs text-muted-foreground hover:bg-accent",
					"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)]",
				)}
				aria-label={`${enCurso ? texto : `Actividad del tutor: ${texto}`}. ${textoPasos(pasos)}`}
			>
				<ChevronRight className="size-3 shrink-0 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
				{enCurso ? (
					<>
						<BrailleSpinner label="Trabajando" />
						<Shimmer duration={1.6} className="truncate">{texto}</Shimmer>
					</>
				) : (
					<>
						{fallos > 0 ? <TriangleAlert className="size-3 shrink-0 text-warning" aria-hidden /> : <Check className="size-3 shrink-0" aria-hidden />}
						<span className="truncate">{texto}</span>
					</>
				)}
				<span className="ml-auto shrink-0">{textoPasos(pasos)}</span>
			</CollapsibleTrigger>
			<CollapsibleContent className="mt-1 flex flex-col gap-1 border-l border-border pl-3 ml-3">
				{children}
			</CollapsibleContent>
		</Collapsible>
	);
}
