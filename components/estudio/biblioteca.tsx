"use client";

/**
 * Biblioteca (ticket 05, historia 9): los documentos del espacio activo, la
 * subida por arrastre o desde una ruta del disco y el estado de cada
 * incorporación. Desde aquí se abre el lector y, en «Estructura y vínculos»,
 * se ve lo extraído y se vincula el documento a una unidad. Traslada al
 * armazón la vista de Biblioteca del plugin (`library-view.ts` y
 * `documents-view.ts`) con las mismas operaciones.
 *
 * `BibliotecaEstudio` es pura; `Biblioteca` la conecta con el plugin.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenIcon, ChevronDownIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { cn } from "@/lib/utils";
import { llamarEstudio } from "./llamar";
import {
	ANCLA_SUBIR, ESTADO_DOCUMENTO, rotuloSeccion, rutaLector, subirArchivo,
	type ArchivoSubida, type DetalleDocumento, type DocumentoEstudio, type ProgresoSubida,
} from "./documentos";

/** Una unidad a la que se puede vincular un documento (de la operación `estado`). */
export interface UnidadVinculable { id: string; title: string; revision: number }

export interface AccionesBiblioteca {
	subir(archivos: ArchivoSubida[]): void;
	incorporarRuta(ruta: string, titulo: string): void;
	/** Abre el lector; sin página, en la última leída. */
	leer(documentId: string, pagina?: number): void;
	/** Abre o cierra «Estructura y vínculos» de un documento. */
	detalle(documentId: string | null): void;
	vincular(unidad: UnidadVinculable, documentId: string, localizador: string): void;
	registrarEnBase(documentId: string): void;
	reintentar(documento: DocumentoEstudio): void;
	borrar(documento: DocumentoEstudio): void;
}

const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MiB`;
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

function datos(d: DocumentoEstudio): string {
	const partes = [`${d.paginas ?? "?"} páginas`];
	if (d.contraste) partes.push(`texto recuperado: ${String(Math.round(d.contraste.recuerdo * 1000) / 10).replace(".", ",")} %`);
	if (d.contraste?.paginasSinTexto.length) partes.push(`${d.contraste.paginasSinTexto.length} páginas sin capa de texto`);
	if (d.revisar.length) partes.push(`${d.revisar.length} avisos que revisar`);
	return partes.join(" · ");
}

export function BibliotecaEstudio({ documentos, subiendo, detalle, unidades, ocupado, error, aviso, acciones }: {
	/** null mientras carga. */
	documentos: DocumentoEstudio[] | null;
	subiendo: ProgresoSubida | null;
	/** La estructura del documento desplegado, si hay uno. */
	detalle: DetalleDocumento | null;
	unidades: UnidadVinculable[];
	ocupado: boolean;
	error: string | null;
	/** Lo que salió bien de la última operación. */
	aviso?: string | null;
	acciones: AccionesBiblioteca;
}) {
	const [encima, setEncima] = useState(false);
	const selector = useRef<HTMLInputElement>(null);
	const elegir = useRef<HTMLButtonElement>(null);
	// Desde «Añadir material» del inicio: la zona a la vista y el botón listo. Abrir el selector de archivos sin un
	// gesto de David no lo permite el navegador. Con una subida en curso o una operación pendiente el botón falta o
	// está desactivado: se espera a que esté listo, una sola vez.
	const anclaPendiente = useRef(true);
	useEffect(() => {
		if (!anclaPendiente.current) return;
		if (window.location.hash !== `#${ANCLA_SUBIR}`) { anclaPendiente.current = false; return; }
		const boton = elegir.current;
		if (!boton || boton.disabled) return;
		anclaPendiente.current = false;
		document.getElementById(ANCLA_SUBIR)?.scrollIntoView({ block: "center" });
		boton.focus();
	}, [subiendo, ocupado]);
	const soltar = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setEncima(false);
		const archivos = [...(e.dataTransfer?.files ?? [])];
		if (archivos.length && !subiendo) acciones.subir(archivos);
	};
	return (
		<div className="mx-auto w-full max-w-2xl px-6 pb-24 pt-14">
			<h1 className="font-title text-4xl tracking-tight">Biblioteca</h1>
			<p className="mt-2 text-muted-foreground">Los documentos de este espacio: léelos, cítalos y vincúlalos a las unidades que estudias.</p>

			<div
				id={ANCLA_SUBIR}
				role="group"
				aria-label="Añadir documentos"
				data-state={subiendo ? "uploading" : encima ? "over" : undefined}
				onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setEncima(true); }}
				onDragLeave={() => setEncima(false)}
				onDrop={soltar}
				className={cn(
					"mt-8 rounded-xl border border-dashed border-border px-6 py-8 text-center transition-colors",
					encima && "border-primary bg-accent/60",
				)}
			>
				{subiendo ? (
					<div className="space-y-3">
						<p className="text-sm">Subiendo «{subiendo.name}»: {mib(subiendo.sent)} de {mib(subiendo.total)}</p>
						<progress className="h-1.5 w-full" max={subiendo.total} value={subiendo.sent} />
					</div>
				) : (
					<>
						<UploadIcon className="mx-auto size-5 text-muted-foreground" />
						<p className="mt-2 font-medium">Arrastra aquí tus PDF</p>
						<p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
							Libros, apuntes, artículos o manuales. Se extraen su texto y su estructura por páginas, y quedan listos para leer, buscar y citar.
						</p>
						<Button ref={elegir} className="mt-4" size="sm" disabled={ocupado} onClick={() => selector.current?.click()}>Elegir archivos</Button>
					</>
				)}
				<input
					ref={selector}
					type="file"
					name="archivo"
					accept="application/pdf,.pdf"
					multiple
					hidden
					onChange={(e) => { const f = e.target.files; if (f?.length) acciones.subir([...f]); e.target.value = ""; }}
				/>
			</div>
			<FormularioRuta ocupado={ocupado} incorporar={acciones.incorporarRuta} />

			{error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
			{aviso && !error && <p role="status" className="mt-4 text-sm text-muted-foreground">{aviso}</p>}

			<section className="mt-10" aria-label="Documentos">
				{documentos === null ? (
					<p className="text-sm text-muted-foreground">Cargando…</p>
				) : documentos.length === 0 ? (
					<p className="text-sm text-muted-foreground">Todavía no hay documentos en este espacio. Arrastra un PDF arriba o incorpóralo desde su ruta.</p>
				) : (
					<ul className="divide-y divide-border">
						{documentos.map(d => (
							<li key={d.id} data-document-id={d.id} data-status={d.status} className="py-3">
								<div className="flex items-center gap-3">
									<BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
									{d.status === "listo" ? (
										<button type="button" onClick={() => acciones.leer(d.id)} className="flex-1 truncate text-left hover:underline">{d.title}</button>
									) : <span className="flex-1 truncate">{d.title}</span>}
									<span className={cn(
										"rounded-md border px-1.5 py-0.5 text-xs",
										d.status === "error" ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground",
									)}>{ESTADO_DOCUMENTO[d.status]}</span>
								</div>
								<div className="mt-1 pl-7">
									{d.status === "procesando" && (
										<p className="text-sm text-muted-foreground">Extrayendo texto y estructura desde las {hora(d.startedAt)}. Puede tardar unos minutos; puedes seguir usando la app.</p>
									)}
									{d.status === "error" && (
										<>
											<p className="text-sm text-destructive">{d.error ?? "Error"}</p>
											<div className="mt-1 flex gap-1">
												<Button size="sm" variant="outline" disabled={ocupado} onClick={() => acciones.reintentar(d)}>Reintentar</Button>
												<Button size="sm" variant="ghost" disabled={ocupado} onClick={() => acciones.borrar(d)}>Borrar</Button>
											</div>
										</>
									)}
									{d.status === "listo" && (
										<>
											<p className="text-sm text-muted-foreground">{datos(d)}</p>
											<div className="mt-1 flex flex-wrap gap-1">
												<Button size="sm" disabled={ocupado} onClick={() => acciones.leer(d.id)}>Leer</Button>
												<Button
													size="sm" variant="ghost" disabled={ocupado}
													aria-expanded={detalle?.document.id === d.id}
													onClick={() => acciones.detalle(detalle?.document.id === d.id ? null : d.id)}
												>
													Estructura y vínculos<ChevronDownIcon className={cn("size-3.5 transition-transform", detalle?.document.id === d.id && "rotate-180")} />
												</Button>
												<Button size="sm" variant="ghost" disabled={ocupado} onClick={() => acciones.borrar(d)}>Borrar</Button>
											</div>
											{detalle?.document.id === d.id && <Detalle detalle={detalle} unidades={unidades} ocupado={ocupado} acciones={acciones} />}
										</>
									)}
								</div>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

/** Para un PDF que ya está en el disco: se incorpora sin subirlo. */
function FormularioRuta({ ocupado, incorporar }: { ocupado: boolean; incorporar(ruta: string, titulo: string): void }) {
	const [ruta, setRuta] = useState("");
	const [titulo, setTitulo] = useState("");
	return (
		<details className="mt-3 text-sm">
			<summary className="cursor-pointer text-muted-foreground">Desde una ruta del disco</summary>
			<form
				className="mt-2 grid gap-2"
				onSubmit={(e) => { e.preventDefault(); if (ruta.trim()) { incorporar(ruta.trim(), titulo.trim()); setRuta(""); setTitulo(""); } }}
			>
				<input
					name="path" aria-label="Ruta del PDF" value={ruta} onChange={(e) => setRuta(e.target.value)}
					placeholder="Ruta completa del PDF, por ejemplo C:\Libros\manual.pdf"
					className="lh-input h-9 rounded-md border border-border bg-background px-3 text-foreground"
				/>
				<input
					name="title" aria-label="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título (opcional)"
					className="lh-input h-9 rounded-md border border-border bg-background px-3 text-foreground"
				/>
				<div><Button size="sm" variant="outline" type="submit" disabled={ocupado || !ruta.trim()}>Incorporar</Button></div>
			</form>
		</details>
	);
}

/** Lo extraído del documento y su vínculo con las unidades. */
function Detalle({ detalle, unidades, ocupado, acciones }: { detalle: DetalleDocumento; unidades: UnidadVinculable[]; ocupado: boolean; acciones: AccionesBiblioteca }) {
	const [unidadId, setUnidadId] = useState(unidades[0]?.id ?? "");
	const [localizador, setLocalizador] = useState("");
	const vistas = new Set<string>();
	const secciones = detalle.secciones.flatMap(s => {
		const rotulo = rotuloSeccion(s.numero, s.titulo);
		if (!rotulo || vistas.has(rotulo)) return [];
		vistas.add(rotulo);
		return [{ clave: s.clave, rotulo, pagina: Math.min(...s.paginas) }];
	});
	const id = detalle.document.id;
	return (
		<div className="mt-3 space-y-5 rounded-xl border border-border px-4 py-4 text-sm">
			{detalle.document.revisar.length > 0 && (
				<ul className="space-y-1 text-muted-foreground">{detalle.document.revisar.map(r => <li key={r}>Revisar: {r}</li>)}</ul>
			)}
			<div>
				<h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Estructura</h3>
				{secciones.length === 0 ? <p className="text-muted-foreground">La extracción no encontró secciones con título.</p> : (
					<ol className="max-h-64 space-y-0.5 overflow-y-auto">
						{secciones.map(s => (
							<li key={s.clave}>
								<button type="button" onClick={() => acciones.leer(id, s.pagina)} className="flex w-full gap-3 rounded px-1 text-left hover:bg-accent">
									<span className="flex-1">{s.rotulo}</span><span className="tabular-nums text-muted-foreground">{s.pagina}</span>
								</button>
							</li>
						))}
					</ol>
				)}
				<p className="mt-2 text-xs text-muted-foreground">
					{detalle.tablas.length} tablas · {detalle.figuras.length} figuras · {detalle.referencias.length} referencias bibliográficas · {detalle.avisos.length} avisos de la extracción
				</p>
			</div>
			<div>
				<h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Vincular a una unidad</h3>
				{unidades.length === 0 ? <p className="text-muted-foreground">No hay unidades activas en este espacio.</p> : (
					<form
						className="flex flex-wrap gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							const u = unidades.find(x => x.id === unidadId) ?? unidades[0]!;
							acciones.vincular(u, id, localizador.trim());
						}}
					>
						<select
							aria-label="Unidad" value={unidadId} onChange={(e) => setUnidadId(e.target.value)}
							className="lh-input h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-foreground"
						>
							{unidades.map(u => <option key={u.id} value={u.id}>{u.title}</option>)}
						</select>
						<input
							aria-label="Sección" value={localizador} onChange={(e) => setLocalizador(e.target.value)} placeholder="Sección o página (opcional): 3, 3.2 o p. 4"
							className="lh-input h-8 w-44 rounded-md border border-border bg-background px-2 text-foreground"
						/>
						<Button size="sm" variant="outline" type="submit" disabled={ocupado}>Vincular</Button>
					</form>
				)}
			</div>
			<div>
				<Button size="sm" variant="ghost" className="-ml-2" disabled={ocupado} onClick={() => acciones.registrarEnBase(id)}>Registrar en la base de conocimiento</Button>
			</div>
		</div>
	);
}

/** Pregunta antes de borrar, nombrando lo que lo usa. */
async function confirmarBorrado(d: DocumentoEstudio): Promise<boolean> {
	const vinculos = await llamarEstudio<{ units: { title: string }[]; notebooks: { title: string }[] }>("documento-vinculos", { id: d.id });
	const usos = [
		vinculos.units.length ? `Dejará de ser fuente de: ${vinculos.units.map(u => `«${u.title}»`).join(", ")}.` : "",
		vinculos.notebooks.length ? `Los cuadernos ${vinculos.notebooks.map(n => `«${n.title}»`).join(", ")} conservan sus notas y citas, sin el vínculo.` : "",
	].filter(Boolean).join("\n");
	return window.confirm(`¿Borrar «${d.title}» de la Biblioteca?${usos ? `\n\n${usos}` : ""}\n\nEl registro y el PDF subido van a la papelera de los datos de Estudio. Los hechos ya confirmados en tu base no cambian.`);
}

/** La página conectada: lee los documentos del espacio activo y se refresca con los avisos del plugin. */
export function Biblioteca() {
	const router = useRouter();
	const [documentos, setDocumentos] = useState<DocumentoEstudio[] | null>(null);
	const [unidades, setUnidades] = useState<UnidadVinculable[]>([]);
	const [abierto, setAbierto] = useState<string | null>(null);
	const [detalle, setDetalle] = useState<DetalleDocumento | null>(null);
	const [subiendo, setSubiendo] = useState<ProgresoSubida | null>(null);
	const [ocupado, setOcupado] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [aviso, setAviso] = useState<string | null>(null);

	const ultima = useRef(0);
	const leer = useCallback(async () => {
		const esta = ++ultima.current;
		try {
			const [docs, estado] = await Promise.all([
				llamarEstudio<DocumentoEstudio[]>("documentos"),
				llamarEstudio<{ units: (UnidadVinculable & { status: string })[] }>("estado"),
			]);
			if (esta !== ultima.current) return;
			setDocumentos(docs);
			setUnidades(estado.units.filter(u => u.status === "activa").map(({ id, title, revision }) => ({ id, title, revision })));
		} catch (e) {
			if (esta === ultima.current) setError(e instanceof Error ? e.message : "No se pudo leer la Biblioteca.");
		}
	}, []);
	useEffect(() => { void leer(); }, [leer]);
	useServerEvent("plugin-message", (m) => { if (m.pluginId === "estudio") void leer(); });
	useServerResync(() => void leer());

	useEffect(() => {
		if (!abierto) { setDetalle(null); return; }
		let vigente = true;
		llamarEstudio<DetalleDocumento>("documento", { id: abierto })
			.then(d => { if (vigente) setDetalle(d); })
			.catch(e => { if (vigente) { setError(e instanceof Error ? e.message : String(e)); setAbierto(null); } });
		return () => { vigente = false; };
	}, [abierto]);

	const operar = async (accion: () => Promise<unknown>, hecho?: string) => {
		setOcupado(true);
		setError(null);
		setAviso(null);
		try {
			await accion();
			if (hecho) setAviso(hecho);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
		await leer();
		setOcupado(false);
	};

	/** Una subida cada vez, los archivos en orden; el progreso se ve en la zona de soltar. */
	const subir = async (archivos: ArchivoSubida[]) => {
		if (subiendo) return;
		setError(null);
		setAviso(null);
		for (const archivo of archivos) {
			setSubiendo({ name: archivo.name, sent: 0, total: archivo.size });
			try { await subirArchivo(archivo, setSubiendo); }
			catch (e) { setError(`${archivo.name}: ${e instanceof Error ? e.message : String(e)}`); }
		}
		setSubiendo(null);
		await leer();
	};

	return (
		<div className="relative h-dvh overflow-y-auto font-prose">
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			<BibliotecaEstudio
				documentos={documentos}
				subiendo={subiendo}
				detalle={detalle}
				unidades={unidades}
				ocupado={ocupado}
				error={error}
				aviso={aviso}
				acciones={{
					subir: (archivos) => void subir(archivos),
					incorporarRuta: (ruta, titulo) => void operar(() => llamarEstudio("incorporar-documento", titulo ? { path: ruta, title: titulo } : { path: ruta })),
					leer: (documentId, pagina) => router.push(rutaLector(documentId, pagina ? { pagina } : {})),
					detalle: setAbierto,
					vincular: (u, documentId, localizador) => void operar(
						() => llamarEstudio("vincular-documento", { unitId: u.id, expectedRevision: u.revision, documentId, ...(localizador ? { locator: localizador } : {}) }),
						`Vinculado a «${u.title}».`,
					),
					registrarEnBase: (documentId) => void operar(() => llamarEstudio("kb-registrar-documento", { documentId }), "Registrado en la base de conocimiento."),
					reintentar: (d) => void operar(() => llamarEstudio("incorporar-documento", { path: d.path, title: d.title })),
					borrar: (d) => void operar(async () => { if (await confirmarBorrado(d)) { await llamarEstudio("borrar-documento", { id: d.id, expectedRevision: d.revision }); if (abierto === d.id) setAbierto(null); } }),
				}}
			/>
		</div>
	);
}
