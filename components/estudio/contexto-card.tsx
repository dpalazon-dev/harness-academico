"use client";

import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudyContextDetails } from "@/src/core";

/**
 * La tarjeta del contexto de estudio (ADR 0003): el primer mensaje de una
 * conversación abierta desde una unidad, un pasaje o un intento. Andamiaje,
 * no un turno: discreta y plegada; al abrirla enseña las líneas que el
 * plugin compuso para David. El modelo lee el texto del propio mensaje.
 */

const ETIQUETA: Record<StudyContextDetails["tipo"], string> = { unidad: "Unidad", pasaje: "Pasaje", intento: "Intento" };

export function StudyContextCard({ data }: { data: StudyContextDetails }) {
	const [open, setOpen] = useState(false);
	const { tipo = "unidad", titulo = "", lineas = [] } = data ?? {};
	return (
		<div data-testid="study-context-card" className="my-1 font-prose">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className="anillo-foco flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
			>
				<ChevronRightIcon aria-hidden="true" className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
				<span className="font-medium">Contexto · {ETIQUETA[tipo] ?? tipo}</span>
				<span className="min-w-0 flex-1 truncate">{titulo}</span>
			</button>
			{open && lineas.length > 0 && (
				<div data-testid="study-context-body" className="mt-1 space-y-1 rounded-lg border border-dashed border-border/70 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
					{lineas.map((l, i) => (
						<p key={i} className="whitespace-pre-wrap">{l}</p>
					))}
				</div>
			)}
		</div>
	);
}
