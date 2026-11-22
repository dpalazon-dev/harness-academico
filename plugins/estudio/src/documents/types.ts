export type DocumentStatus = 'procesando' | 'listo' | 'error';

/** A PDF incorporated through KBOL's Document Intelligence. Artifacts live in the DI store, addressed by hash. */
export interface StudyDocument {
  id: string;
  revision: number;
  title: string;
  path: string;
  status: DocumentStatus;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  original: { sha256: string; bytes: number } | null;
  doclingSha256: string | null;
  estructuraSha256: string | null;
  paginas: number | null;
  contraste: { recuerdo: number; respaldo: number; paginasSinTexto: number[] } | null;
  revisar: string[];
  areaId: string | null;
}
