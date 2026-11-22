import fs from 'node:fs';
import path from 'node:path';
import { fields, id, text } from '../study/schema.ts';
import { StudyError } from '../study/types.ts';

/** Plugin calls are JSON through a proxy capped at 26 MiB, so a PDF travels in base64 chunks well under that. */
export const CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
/** Unfinished uploads older than this are removed on activation. */
const STALE_MS = 24 * 60 * 60 * 1000;

export interface UploadOptions {
  /** Where partial uploads live while they arrive. */
  partsDir: string;
  /** Where finished PDFs are kept; Document Intelligence reads them from here. */
  libraryDir: string;
  newId: () => string;
  /** Hands the finished file to the document service. */
  incorporate: (file: string, title: string) => unknown;
}

export interface UploadService {
  start(input: unknown): { uploadId: string; chunkBytes: number };
  chunk(input: unknown): { received: number };
  finish(input: unknown): unknown;
  cancel(input: unknown): void;
}

interface Pending { name: string; bytes: number; received: number; next: number }

/** A file name that is safe on Windows and still recognisable. */
export function safeName(name: string): string {
  const base = path.basename(name).replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 120);
  return `${base || 'documento'}.pdf`;
}

export function createUploadService(options: UploadOptions): UploadService {
  const { partsDir, libraryDir, newId } = options;
  fs.mkdirSync(partsDir, { recursive: true });
  for (const f of fs.readdirSync(partsDir)) {
    const p = path.join(partsDir, f);
    try { if (Date.now() - fs.statSync(p).mtimeMs > STALE_MS) fs.rmSync(p, { force: true }); } catch { /* best effort */ }
  }
  const pending = new Map<string, Pending>();
  const partPath = (uploadId: string) => path.join(partsDir, `${uploadId}.part`);

  function get(input: unknown, extra: string[]): { uploadId: string; upload: Pending; r: Record<string, unknown> } {
    const r = fields(input, ['uploadId', ...extra], 'input');
    const uploadId = id(r.uploadId, 'input.uploadId');
    const upload = pending.get(uploadId);
    if (!upload) throw new StudyError('NOT_FOUND', 'La subida no existe o ya terminó');
    return { uploadId, upload, r };
  }

  function drop(uploadId: string): void {
    pending.delete(uploadId);
    fs.rmSync(partPath(uploadId), { force: true });
  }

  return {
    start(input) {
      const r = fields(input, ['name', 'bytes'], 'input');
      const name = text(r.name, 500, 'input.name', { required: true });
      if (!/\.pdf$/i.test(name)) throw new StudyError('INVALID_INPUT', 'Solo se incorporan archivos PDF');
      if (!Number.isSafeInteger(r.bytes) || (r.bytes as number) <= 0) throw new StudyError('INVALID_INPUT', 'El archivo está vacío');
      if ((r.bytes as number) > MAX_UPLOAD_BYTES) throw new StudyError('INVALID_INPUT', `El archivo supera ${MAX_UPLOAD_BYTES / 1024 / 1024} MiB`);
      const uploadId = newId();
      fs.writeFileSync(partPath(uploadId), '');
      pending.set(uploadId, { name, bytes: r.bytes as number, received: 0, next: 0 });
      return { uploadId, chunkBytes: CHUNK_BYTES };
    },

    chunk(input) {
      const { uploadId, upload, r } = get(input, ['index', 'data']);
      if (r.index !== upload.next) throw new StudyError('CONFLICT', `Se esperaba el trozo ${upload.next}`);
      if (typeof r.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(r.data)) throw new StudyError('INVALID_INPUT', 'Trozo no válido');
      const bytes = Buffer.from(r.data, 'base64');
      if (bytes.length === 0 || bytes.length > CHUNK_BYTES || upload.received + bytes.length > upload.bytes) {
        drop(uploadId);
        throw new StudyError('INVALID_INPUT', 'El trozo no cuadra con el tamaño anunciado; vuelve a subir el archivo');
      }
      fs.appendFileSync(partPath(uploadId), bytes);
      upload.received += bytes.length;
      upload.next++;
      return { received: upload.received };
    },

    finish(input) {
      const { uploadId, upload, r } = get(input, ['title']);
      const part = partPath(uploadId);
      try {
        if (upload.received !== upload.bytes) throw new StudyError('INVALID_INPUT', 'La subida está incompleta; vuelve a subir el archivo');
        const head = Buffer.alloc(5);
        const fd = fs.openSync(part, 'r');
        try { fs.readSync(fd, head, 0, 5, 0); } finally { fs.closeSync(fd); }
        if (head.toString('latin1') !== '%PDF-') throw new StudyError('INVALID_INPUT', 'El archivo no es un PDF');
        fs.mkdirSync(libraryDir, { recursive: true });
        const file = path.join(libraryDir, `${uploadId.slice(0, 8)}-${safeName(upload.name)}`);
        fs.renameSync(part, file);
        pending.delete(uploadId);
        const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 500) : path.basename(upload.name, path.extname(upload.name));
        return options.incorporate(file, title);
      } catch (error) {
        drop(uploadId);
        throw error;
      }
    },

    cancel(input) {
      const { uploadId } = get(input, []);
      drop(uploadId);
    },
  };
}
