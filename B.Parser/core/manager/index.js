


























export { Manager } from "./manager-core.js";


export { writeDocxPlain, writeDocxLayout, writePdf } from "../io/render.js";


import { getLogen } from "../../_path.js";
const { SILENT, collect, stdoutLog, tee, resolveLog } = (await getLogen()).parserLog;
export { SILENT, collect, stdoutLog, tee, resolveLog };
