"use client";

/**
 * Lo que se ve donde iba una lectura que falló: «No se pudo leer …» y, si se puede, «Reintentar». Sustituye al
 * «Cargando…» que, sin datos y con la lectura caída, se quedaba para siempre.
 */
import { cn } from "@/lib/utils";

export function ErrorDeLectura({ que, reintentar, className }: {
	/** Lo que no se pudo leer, con su artículo: «la agenda», «la Biblioteca». */
	que: string;
	reintentar?: () => void;
	className?: string;
}) {
	return (
		<p role="alert" data-error-lectura className={cn("text-sm text-destructive", className)}>
			No se pudo leer {que}.
			{reintentar && (
				<> <button
					type="button" onClick={reintentar} data-reintentar
					className="anillo-foco rounded-sm text-foreground underline underline-offset-2 hover:text-foreground/80"
				>Reintentar</button></>
			)}
		</p>
	);
}
