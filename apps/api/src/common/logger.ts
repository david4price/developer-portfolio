import { ConsoleLogger } from '@nestjs/common';
import { type LogLevel, logLevelsUpTo } from '@portfolio/config';

/** JSON-lines logger that emits `level` and everything more severe. */
export function createJsonLogger(context: string, level: LogLevel): ConsoleLogger {
  return new ConsoleLogger(context, { json: true, logLevels: logLevelsUpTo(level) });
}
