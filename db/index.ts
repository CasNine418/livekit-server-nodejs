import mysql from 'mysql2/promise';
import { ConnectionOptions, Pool } from 'mysql2/promise';
import { Logger } from 'tslog'
const Log = new Logger({ name: 'api.ts' });

class DB {
    private pool: Pool;
    private config: ConnectionOptions;

    constructor(config: ConnectionOptions) {
        this.config = config;
        this.pool = mysql.createPool(this.config);
        this.setupConnectionErrorHandler();
    }

    private setupConnectionErrorHandler() {
        this.pool.on('connection', (connection) => {
            connection.on('error', (err) => {
                Log.error(`Database connection error: ${err.message}`);
                if (err.code === 'PROTOCOL_CONNECTION_LOST') {
                    Log.warn('Database connection lost. Attempting to reconnect...');
                    this.reconnect();
                } else {
                    Log.error(`Unhandled database error: ${err.message}`);
                    this.reconnect();
                }
            });
        });
    }

    private reconnect() {
        Log.warn('Reconnecting to the database...');
        this.pool.end().then(() => {
            this.pool = mysql.createPool(this.config);
            this.setupConnectionErrorHandler();
            Log.info('Database reconnected');
        }).catch((error) => {
            Log.error(`Error reconnecting to the database: ${error.message}`);
            setTimeout(() => this.reconnect(), 5000);
        });
    }

    public async query(query: string, values?: any[]): Promise<any> {
        try {
            const connection = await this.pool.getConnection();
            try {
                const [rows] = await connection.execute(query, values);
                return rows;
            } finally {
                connection.release();
            }
        } catch (error) {
            throw error;
        }
    }

    public async getConnection(): Promise<mysql.PoolConnection> {
        return await this.pool.getConnection();
    }

    public async close(): Promise<void> {
        try {
            await this.pool.end();
        } catch (error) {
            Log.error(`Error in DB close: ${error}`);
            throw error;
        }
    }
}

export default DB;