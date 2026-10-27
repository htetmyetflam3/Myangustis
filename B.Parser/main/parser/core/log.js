/**
 * FILE: Parsed/parser/core/log.mjs
 *
 * THE LOG CONTRACT. One owner for "what a log sink is" in the parser.
 *
 * Every stage in this parser already takes a `log` parameter and defaults it to
 * a no-op. That is the right shape and it does not change: stages emit, they
 * never decide where the text goes. What was missing is a single place that
 * says what a sink IS -- so the prefixes, the silence rule and the collector
 * were being re-invented at every entry point, tool and test.
 *
 * A sink is just:  (message: string) => void
 *
 * Three are built here, and they cover every caller in the tree today:
 *
 *   SILENT      discard. The default for every stage parameter.
 *   stdoutLog() write a line to stdout. What the CLI uses.
 *   collect()   push into an array. What every test and tool already does by
 *               hand (`const log = []; ... (m) => log.push(String(m))`), now
 *               with the array hanging off the function as `.lines`.
 *
 * The four prefixes below are the ones already in use across the parser; they
 * are named so a future structured logger can key off them instead of
 * re-matching "[+] " with a regex.
 *
 *   ok()    [+]  a step completed
 *   warn()  [-]  a step failed or refused
 *   info()  [i]  a decision worth seeing, no failure
 *   step()  (indented) per-page / per-item detail under a step
 */

export const PREFIX = Object.freeze({ ok: "[+]", warn: "[-]", info: "[i]", step: "   " });

/** Discard everything. The default sink for every stage parameter. */
export const SILENT = () => {};

/** Write one line per message to stdout. The CLI sink. */
export const stdoutLog = () => (message) => process.stdout.write(`${message}\n`);

/**
 * Collect into an array. `sink.lines` is the array, live.
 * Replaces the hand-rolled `const out = []; (m) => out.push(String(m))` that
 * appears in every parser test and tool.
 */
export function collect() {
  const lines = [];
  const sink = (message) => { lines.push(String(message)); };
  sink.lines = lines;
  return sink;
}

/** Send one message to several sinks (e.g. stdout AND a transcript). */
export const tee = (...sinks) => (message) => { for (const s of sinks) s(message); };

/**
 * Resolve the caller's logging options into exactly one sink.
 *
 * The rule the CLI entry had inline: an explicit function wins; an explicit
 * `false` on either option silences; otherwise stdout. Kept verbatim so CLI
 * behaviour is unchanged -- it just stops being re-derived per entry point.
 */
export function resolveLog({ logging = true, log } = {}) {
  if (typeof log === "function") return log;
  return (logging !== false && log !== false) ? stdoutLog() : SILENT;
}

export const ok = (log, message) => log(`${PREFIX.ok} ${message}`);
export const warn = (log, message) => log(`${PREFIX.warn} ${message}`);
export const info = (log, message) => log(`${PREFIX.info} ${message}`);
export const step = (log, message) => log(`${PREFIX.step} ${message}`);
