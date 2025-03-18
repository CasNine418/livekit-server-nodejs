import moment from 'moment';

class Log {
    private static getFormattedDateTime(): string {
        const dateTime = moment();
        return `[${dateTime.format('YYYY-MM-DD HH:mm:ss')}]`;
    }

    static info(description: string, location: string) {
        const formattedDateTime = Log.getFormattedDateTime();
        console.log(`${formattedDateTime}[${location}][INFO] ${description}`);
    }

    static warn(description: string, location: string) {
        const formattedDateTime = Log.getFormattedDateTime();
        console.warn('\x1B[33m%s\x1B[0m',`${formattedDateTime}[${location}][WARN] ${description}`);
    }

    static error(description: string, location: string) {
        const formattedDateTime = Log.getFormattedDateTime();
        console.error('\x1B[31m%s\x1B[0m',`${formattedDateTime}[${location}][ERROR] ${description}`);
    }
}

export default Log;