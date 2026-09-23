import type { SapConnection } from "./connection.js";
import { sqlLiteral } from "./objects.js";

/** Paquete y, si se pide, sus subpaquetes (hasta 5 niveles). `subs` son los hijos encontrados (directos si no es recursivo). */
export async function packageTree(sap: SapConnection, root: string, recursive: boolean): Promise<{ packages: string[]; subs: string[] }> {
  const packages = [root];
  const subs: string[] = [];
  let frontier = [root];
  for (let level = 0; level < (recursive ? 5 : 1) && frontier.length; level++) {
    const r = await sap.query(`SELECT devclass FROM tdevc WHERE parentcl IN ( ${frontier.map(sqlLiteral).join(", ")} )`, 2000);
    frontier = r.values.map((v) => v.DEVCLASS as string);
    subs.push(...frontier);
    if (recursive) packages.push(...frontier);
  }
  return { packages, subs };
}

export interface TadirRow {
  DEVCLASS: string;
  PGMID: string;
  OBJECT: string;
  OBJ_NAME: string;
}

/**
 * Objetos R3TR de esos paquetes (sin DEVC), ordenados por tipo y nombre. Sin los marcados como borrados
 * (DELFLAG = 'X'): TADIR los conserva, pero ya no existen en el repositorio.
 */
export async function packageObjects(sap: SapConnection, packages: string[], max: number, objectType?: string): Promise<TadirRow[]> {
  const typeFilter = objectType ? ` AND object = ${sqlLiteral(objectType.toUpperCase())}` : "";
  const r = await sap.query(
    `SELECT devclass, pgmid, object, obj_name FROM tadir WHERE pgmid = 'R3TR' AND devclass IN ( ${packages.map(sqlLiteral).join(", ")} )` +
      `${typeFilter} AND object <> 'DEVC' AND delflag = ' ' ORDER BY object, obj_name`,
    max,
  );
  return r.values as unknown as TadirRow[];
}
