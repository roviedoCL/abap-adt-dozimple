import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Notas que una tool deja durante su ejecución para que el registro las anteponga a la respuesta (p. ej. «se pidió
 * PROG, se resolvió como include PROG/I»). Así cualquier tool que use resolveObject lo cuenta sin tocar su texto.
 */
const store = new AsyncLocalStorage<string[]>();

export async function withNotes<T>(fn: () => Promise<T>): Promise<{ result: T; notes: string[] }> {
  const notes: string[] = [];
  const result = await store.run(notes, fn);
  return { result, notes };
}

export function addNote(note: string): void {
  const notes = store.getStore();
  if (notes && !notes.includes(note)) notes.push(note);
}

export const renderNotes = (notes: string[]) => (notes.length ? notes.map((n) => `Nota: ${n}`).join("\n") + "\n\n" : "");
