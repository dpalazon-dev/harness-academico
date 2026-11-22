#!/usr/bin/env node
/* Mide el modo proactivo del cuaderno (ticket 12e): llamadas, fallos y tokens por hora de escritura.
 *
 *   node plugins/estudio/scripts/medir-proactivo.mjs <carpeta de datos de Estudio> [días]
 *
 * La carpeta es la de `lecturas-proactivas.jsonl` (en la aplicación, `<datos>/core-plugin-data/estudio`). Una «hora de
 * escritura» es una hora natural, en hora de Madrid, con al menos una lectura del tutor: no se mide tiempo de estudio, así que
 * es la mejor aproximación sin añadir nada. Con `días`, solo cuenta los últimos. */
import fs from 'node:fs';
import path from 'node:path';

const [dir, dias] = process.argv.slice(2);
if (!dir) { console.error('Uso: node medir-proactivo.mjs <carpeta de datos de Estudio> [días]'); process.exit(2); }
const leer = (nombre) => {
  try { return fs.readFileSync(path.join(dir, nombre), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; }
};
const desde = dias ? Date.now() - Number(dias) * 86_400_000 : 0;
const lecturas = leer('lecturas-proactivas.jsonl').filter(l => Date.parse(l.at) >= desde);
if (lecturas.length === 0) { console.log('No hay lecturas proactivas en ese periodo.'); process.exit(0); }

const hora = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
const horas = new Map();
for (const l of lecturas) {
  const k = `${hora.format(new Date(l.at))}h`;
  const h = horas.get(k) ?? { llamadas: 0, comentarios: 0, fallos: 0, tokens: 0, ms: 0 };
  h.llamadas++;
  if (l.resultado === 'comentado') h.comentarios++;
  if (l.resultado === 'fallo') h.fallos++;
  h.tokens += l.input + l.output + l.cacheRead + l.cacheWrite;
  h.ms += l.ms;
  horas.set(k, h);
}
console.table(Object.fromEntries(horas));
const filas = [...horas.values()];
const suma = (campo) => filas.reduce((a, h) => a + h[campo], 0);
console.log(`Horas con escritura: ${filas.length}`);
console.log(`Llamadas por hora: ${(suma('llamadas') / filas.length).toFixed(1)} de media, ${Math.max(...filas.map(h => h.llamadas))} como máximo`);
console.log(`Tokens por hora: ${Math.round(suma('tokens') / filas.length)} de media (entrada, salida y caché)`);
console.log(`Comentarios por llamada: ${(suma('comentarios') / suma('llamadas')).toFixed(2)}; fallos: ${suma('fallos')}`);
const porDia = new Map();
for (const l of lecturas) porDia.set(l.dia, (porDia.get(l.dia) ?? 0) + 1);
console.log(`Día con más lecturas: ${Math.max(...porDia.values())} (el tope diario las corta)`);
// El host apunta cada llamada en `usage.jsonl` con su propósito: las de segundo plano incluyen también los resúmenes de conversación.
const segundoPlano = leer('usage.jsonl').filter(u => u.purpose === 'background' && Date.parse(u.timestamp) >= desde).length;
console.log(`Para contrastar: usage.jsonl tiene ${segundoPlano} llamadas en segundo plano (las proactivas más los resúmenes).`);
