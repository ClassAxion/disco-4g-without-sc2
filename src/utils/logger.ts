import { format, transports, createLogger } from 'winston';

const loggerFormat = format.combine(
    format.label(),
    format.timestamp(),
    format.printf(({ level, message, _, timestamp }) => `${timestamp} ${level}: ${message}`),
);

const logger = createLogger({
    level: 'info',
    format: loggerFormat,
    defaultMeta: { service: 'app' },
    transports: [
        new transports.File({ filename: './error.log', level: 'error' }),
        new transports.File({ filename: './app.log', level: 'debug' }),
        new transports.Console({ format: loggerFormat }),
    ],
});

export default logger;
