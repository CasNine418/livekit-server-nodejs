import mysql from 'mysql2/promise';
import { ConnectionOptions } from 'mysql2/promise';
import Clg from '../utils/clg';

class DB {
    private pool: mysql.Pool;
    private config: ConnectionOptions;

    constructor(config: ConnectionOptions) {
        this.config = config;
        this.pool = mysql.createPool(this.config);
    }

    public async query(query: string, values?: any[]): Promise<any> {
        try {
            const [rows] = await this.pool.query(query, values);
            return rows;
        } catch (error) {
            Clg.error(`Error in DB query: ${error}`, 'DB.query');
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
            Clg.error(`Error in DB close: ${error}`, 'DB.close');
            throw error;
        }
    }
}

export default DB;