


























export { Manager } from "./manager.js";


export { writeDocxPlain, writeDocxLayout, writePdf } from "./write/render.js";


import { getLogen } from "../../_path.js";
const { SILENT, collect, stdoutLog, tee, resolveLog } = (await getLogen()).parserLog;
export { SILENT, collect, stdoutLog, tee, resolveLog };
