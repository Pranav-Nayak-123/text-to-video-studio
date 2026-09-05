const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (COLOR ? `[${code}m${s}[0m` : s);

export const log = {
  step: (msg) => console.log(`${c('36;1', '▸')} ${c('1', msg)}`),
  info: (msg) => console.log(`  ${c('90', '·')} ${msg}`),
  ok: (msg) => console.log(`  ${c('32;1', '✓')} ${msg}`),
  warn: (msg) => console.log(`  ${c('33;1', '!')} ${c('33', msg)}`),
  error: (msg) => console.error(`  ${c('31;1', '✗')} ${c('31', msg)}`),
  blank: () => console.log(''),
  banner: (title) => {
    const line = '─'.repeat(Math.max(8, title.length + 4));
    console.log(`\n${c('36', line)}\n${c('36;1', `  ${title}`)}\n${c('36', line)}`);
  },
};

/**
 * A pipeline error that carries a remediation hint so failures are never silent
 * and always actionable.
 */
export class PipelineError extends Error {
  constructor(message, { hint, cause, stage } = {}) {
    super(message, { cause });
    this.name = 'PipelineError';
    this.hint = hint;
    this.stage = stage;
  }
}

/** Print an error with its remediation hint and underlying cause. */
export function reportError(err) {
  log.error(err?.message ?? String(err));
  if (err?.stage) log.info(`stage: ${err.stage}`);
  if (err?.hint) log.info(`hint:  ${err.hint}`);
  if (err?.cause) log.info(`cause: ${err.cause.message ?? err.cause}`);
  if (process.env.DEBUG && err?.stack) console.error(err.stack);
}
