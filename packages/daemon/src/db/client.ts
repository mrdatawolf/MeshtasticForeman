import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { openDb, clearDbLock } from "./open.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PGLITE_DIR ?? join(__dirname, "../../../../pglite-data");

clearDbLock(DATA_DIR);
export const db = await openDb(DATA_DIR);
