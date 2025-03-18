import express, { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import https from 'https';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import bodyParser from 'body-parser';
import config from './app_options';
import { Logger } from 'tslog'
const Log = new Logger({ name: 'server.ts' });
import DB from './db';
import AppRouter from './router';
import { buildErrorResponse } from './utils/buildResponse';
import { sendErrorResponse } from './utils/sendMessage';
import { WebSocketServer } from './ws';
import { ChatWebSocket } from './chat';

class Server {
    private app: express.Application;
    private db: DB;
    private router: AppRouter;

    constructor() {
        this.app = express();
        this.db = new DB({
            host: config.db_host,
            user: config.db_user,
            password: config.db_password,
            database: config.db_database,
        });
        this.router = new AppRouter(this.app, this.db);
        this.setupMiddleware();
        this.setupErrorHandling();
        this.setupRoutes();
    }

    private handleError (res: Response, err: any, location: string, errorCode?: number) {
        Log.error(`${err}`);
        sendErrorResponse(res, 500, 'Internal Server Error', errorCode ?? -1);
    };

    private setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(bodyParser.json());
        this.app.locals.db = this.db;
    }

    private setupErrorHandling() {
            this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
            if (err instanceof SyntaxError && err.message.includes('JSON')) {
                sendErrorResponse(res, 400, 'Invalid JSON format', 400)
            } else {
                this.handleError(res, `Uncaught exception: ${err}`, 'error_catcher');
            }
        });
    }

    private setupRoutes() {
        this.router.setupRoutes();
    }

    public start() {
        const mode = config.run_mode;
        const appPort = config.app_port;

        if (mode === 'http') {
            this.app.listen(appPort, () => {
                console.log('Test Mode on http');
                Log.info(`Server is running on port ${appPort}`);
            });
            const wsServer = new WebSocketServer();
            wsServer.start();
            const chatServer = new ChatWebSocket();
            chatServer.start();
        } else if (mode === 'https') {
            const httpsOptions = {
                key: fs.readFileSync('./cert/privkey.key'),
                cert: fs.readFileSync('./cert/domain.crt'),
            };

            https.createServer(httpsOptions, this.app).listen(appPort, () => {
                Log.info(`Server is running at port ${appPort}`);
            });

            const wsServer = new WebSocketServer();
            wsServer.start();
            const chatServer = new ChatWebSocket();
            chatServer.start();
        } else {
            Log.error('Err: Invalid run mode');
        }

        process.on('SIGINT', async () => {
            Log.info("Closing database connection pool...");
            if (this.db) {
                await this.db.close();
            }
            Log.info("Server closed");
            process.exit(0);
        });
    }
}

export default Server;