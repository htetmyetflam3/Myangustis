/**
 * FILE: Parsed/parser/write/ttf.mjs
 *
 * The font reader moved to read/ttf.mjs -- reading a font program is a
 * read concern, and codepage/ needs it too. write/ is above read/, so
 * this re-export keeps pdf-writer.mjs unchanged.
 */
export { TtfFont, loadFont } from "../read/ttf.mjs";
