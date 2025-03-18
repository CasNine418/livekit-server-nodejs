import { z } from "zod";
import ws, { WebSocket } from 'ws';
import { ChatServerMessageSchema, ErrorMessageSchema, WelcomeMessageSchema } from "./schemas";
import { Logger } from "tslog";
import config from '../app_options';
import express from 'express';
import path from 'path';
import fs, { readFileSync } from 'fs';
import { decodeToken } from "../middleware/verify";
import https from 'https';
import { IncomingMessage } from "http";
import { v4 as uuid } from 'uuid';
import { parseQueryParams } from "../utils/params";

const Log = new Logger({ name: 'chat.ts' });

interface ConnectionInstance {
    ws: WebSocket;
    user: string;
    ip: string;
    connectionAt: Date;
    lastActivity: Date;
}

class ChatWebSocket {
    private serverStartAt: Date = new Date();
    private lastMessageUuid: string = ''
    private serverMessagesFlow: z.infer<typeof ChatServerMessageSchema>[] = [];
    private connectionPool = new Map<string, ConnectionInstance>();
    private serverUuid: string = uuid();

    constructor() { };

    private rejectConnection(ws: WebSocket, reason: string, code?: number) {
        ws.close(code ?? 1008, reason);
    }

    private sendChatBoardcast(wss: ws.Server, data: z.infer<typeof ChatServerMessageSchema>) {
        wss.clients.forEach((client) => {
            if (client.readyState === ws.OPEN) {
                client.send(JSON.stringify(data));
            } else {
                Log.error('Client is not connected');
                client.terminate();
            }
        });
    }

    private sendWsErrorMessage(ws: WebSocket, wss: ws.Server, data: z.infer<typeof ErrorMessageSchema>) {
        ws.send(JSON.stringify(data));
    }

    private sendWelcomeMessage(ws: WebSocket) {
        const sendData: z.infer<typeof WelcomeMessageSchema> = {
            uuid: uuid(),
            type: 'welcome',
            senderUuid: this.serverUuid,
            data: {
                serverUuid: this.serverUuid,
                serverStartAt: this.serverStartAt,
                lastMessageUuid: this.lastMessageUuid,
                serverMessagesFlow: this.serverMessagesFlow,
            },
            timestamp: Date.now(),
        };

        ws.send(JSON.stringify(sendData));
    }

    private pushMessage(data: z.infer<typeof ChatServerMessageSchema>) {
        
        if (this.serverMessagesFlow.length > 200) {
            this.serverMessagesFlow.shift();
        }
        this.serverMessagesFlow.push(data);
        this.lastMessageUuid = data.uuid;
    }

    private async handleMessage(ws: WebSocket, wss: ws.Server, message: string) {
        try {
            const raw: z.infer<typeof ChatServerMessageSchema> = JSON.parse(message);
            const data = ChatServerMessageSchema.parse(raw);

            switch (data.type) {
                case 'text':
                    this.pushMessage(data);
                    this.sendChatBoardcast(wss, data);
                    break;
                default:
                    Log.error(`Invalid message type: ${data.type}`);
                    break;
            }
        } catch (error) {
            Log.error(error);
        }
    }

    public start() {
        const app = express();
        const mode = config.run_mode;

        if (mode !== 'http' && mode !== 'https') {
            Log.error(`Invalid run mode: ${mode}. Expected "http" or "https".`);
            process.exit(1);
        }

        let server;

        if (mode === 'http') {
            server = require('http').createServer(app);
            server.listen(config.chat_port, () => {
                Log.info(`The Chat server is being upgraded from the HTTP server`);
            });
        } else if (mode === 'https') {
            const httpsOptions = {
                key: fs.readFileSync(path.join(__dirname, '../cert/privkey.key')),
                cert: fs.readFileSync(path.join(__dirname, '../cert/domain.crt')),
            };
            server = https.createServer(httpsOptions, app);
            server.listen(config.chat_port, () => {
                Log.warn(`The Chat TLS server is being upgraded from the HTTPS server`);
            });
        }

        const wsOptions: ws.ServerOptions = {
            server: server,
        };

        const wss = new ws.Server(wsOptions);

        wss.on('listening', () => [
            Log.info(`The Chat server is listening on port ${config.chat_port}`),
        ])

        wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
            if (!req.url) {
                this.rejectConnection(ws, 'Missing URL parameters');
                Log.error(`Missing URL parameters`);
                return;
            }

            const paramsObj = parseQueryParams(req.url);
            const { identity, token } = paramsObj;

            if (!identity || !token) {
                this.rejectConnection(ws, 'Missing identity or token');
                Log.error(`Missing identity or token`);
                return;
            }

            const decoded = decodeToken(token);
            if (!decoded || decoded.identity !== identity) {
                this.rejectConnection(ws, 'Invalid token');
                Log.error(`Invalid token`);
                return;
            }

            this.connectionPool.set(identity, {
                ws: ws,
                user: identity,
                ip: req.socket.remoteAddress ?? '0.0.0.0',
                connectionAt: new Date(),
                lastActivity: new Date(),
            });

            this.sendWelcomeMessage(ws);

            ws.on('message', (message: ws.RawData) => {
                this.handleMessage(ws, wss, message.toString())
            });

            ws.on('close', () => {
                this.connectionPool.delete(identity);
            })
        })
    }
}

// const a = new ChatWebSocket();
// a.start();

export { ChatWebSocket };