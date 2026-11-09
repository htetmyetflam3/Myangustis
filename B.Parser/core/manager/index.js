/*
(Support 21) Shared support, no chain position - the Manager barrel file.
This module re-exports the Manager (Support 22), the output writers and the log helpers so importers have one place to import from.
*/



























export { Manager } from "./manager-core.js";


export { writeDocxPlain, writeDocxLayout, writePdf } from "../io/render.js";


import { getLogen } from "../../_path.js";
const { SILENT, collect, stdoutLog, tee, resolveLog } = (await getLogen()).parserLog;
export { SILENT, collect, stdoutLog, tee, resolveLog };
