const NO_COLOR = process.env.NO_COLOR !== undefined;

const ansi = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const TAGS = {
  info: { label: 'info', color: ansi.cyan },
  warn: { label: 'warn', color: ansi.yellow },
  error: { label: 'error', color: ansi.red },
  success: { label: 'success', color: ansi.green },
};

const supportsColor = (stream) => !NO_COLOR && stream.isTTY;

const colorize = (text, color, stream) => (
  supportsColor(stream) ? `${color}${text}${ansi.reset}` : text
);

const formatLine = (level, message, stream) => {
  const tag = TAGS[level] || { label: level, color: ansi.gray };
  const tagText = colorize(`[${tag.label}]`, tag.color, stream);
  return `${tagText} ${message}`;
};

const write = (stream, level, message) => {
  stream.write(`${formatLine(level, message, stream)}\n`);
};

module.exports = {
  info: (message) => write(process.stdout, 'info', message),
  // Keep warnings on stdout so they stay ordered with info/success in pipes/TTYs.
  warn: (message) => write(process.stdout, 'warn', message),
  error: (message) => write(process.stderr, 'error', message),
  success: (message) => write(process.stdout, 'success', message),
};
