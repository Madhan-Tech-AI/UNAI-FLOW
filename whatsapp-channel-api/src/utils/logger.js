const config = require('../config');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[config.logLevel] ?? 1;

function formatMsg(level, tag, message) {
  const ts = new Date().toISOString();
  return `[${ts}] [${level.toUpperCase()}] [${tag}] ${message}`;
}

const logger = {
  debug(tag, msg) {
    if (currentLevel <= 0) console.log(formatMsg('debug', tag, msg));
  },
  info(tag, msg) {
    if (currentLevel <= 1) console.log(formatMsg('info', tag, msg));
  },
  warn(tag, msg) {
    if (currentLevel <= 2) console.warn(formatMsg('warn', tag, msg));
  },
  error(tag, msg) {
    if (currentLevel <= 3) console.error(formatMsg('error', tag, msg));
  },
};

module.exports = logger;
