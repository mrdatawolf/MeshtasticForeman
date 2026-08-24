import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { openDb } from "./open.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PGLITE_DIR ?? join(__dirname, "../../../../pglite-data");

export const db = await openDb(DATA_DIR);
