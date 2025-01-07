/**
 * app.ts
 */


// packages
import express, { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { expressjwt } from 'express-jwt';

// node.js
import https from 'https';
import fs from 'fs';
import path from 'path';
import bodyParaser from 'body-parser';

// config
import config from './app_options';

// utils
import Clg from './utils/clg';
import plogo from './utils/plogo';

// database
import DB from './db';

// middleware
import { verifyToken } from './middleware/verifytoken';

const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParaser.json());

// 常量定义空间
const mode = config.run_mode;
const app_port = config.app_port;
const wss_port = config.wss_port;

const currentFileName = path.basename(__filename);

// 数据库配置
const dbConfig = {
    host: config.db_host,
    user: config.db_user,
    password: config.db_password,
    database: config.db_database,
}

const db = new DB(dbConfig);

// 共享连接池
app.locals.db = db;

// 错误捕获中间件
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && err.message.includes('JSON')) {
        // 捕获 JSON 解析错误
        res.status(400).json({
            message: 'Invalid JSON format',
            error: err.message
        });
    }

    // 处理其他类型的错误
    Clg.error(`Uncaught exception: ${err.stack}`, 'error_catcher');
    res.status(500).json({
        message: 'Internal Server Error',
        error: err.message
    });
});

// 验证token是否过期
app.post('/isTokenValid', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if(token == null) {
        Clg.error('Err: Token null', 'IsTokenValid');
        res.status(401).send(JSON.stringify({
            message: 'Unauthorized',
        }));
    } else {
        jwt.verify(token, config.jwtSecretKey, (err: any, user: any) => {
            if(err) {
                if(err.name === 'TokenExpiredError') {
                    Clg.warn('Token expired', 'IsTokenValid');
                    res.status(401).json({
                        message: 'Token expired',
                    });
                } else {
                    Clg.error('Err: Token Unauthorized', 'IsTokenValid');
                    res.status(401).json({
                        message: 'Unauthorized',
                    });
                }
            } else {
                Clg.info('Token valid', 'IsTokenValid');
                res.status(200).json({
                    message: 'Token valid',
                });
            }
        })
    }
})

// 路由

import user from './router/user';
app.use('/user', user);

import server from './router/server';
app.use('/server', verifyToken, server);

app.get('/verify_token', verifyToken, (req: Request, res: Response) => {
    res.status(200).json({
        message: 'Token valid',
    });
});

import WebSocketApp from './ws';

// 启动服务器
if(mode === 'http') {
    // http mode
    app.listen(app_port, () => {
        console.log('Test Mode on http');
        Clg.info(`Server is running on port ${app_port}`, `ServerStart:HTTP`);
    });
    // createWebSocketServer();
    const wsServer = new WebSocketApp(config.httpServerUrl);
    wsServer.start();
} else if(mode === 'https') {
    const httpsOptions = {
        key: fs.readFileSync('./cert/privkey.key'),
        cert: fs.readFileSync('./cert/domain.crt'),
        // ca: [fs.readFileSync('./cert/root_bundle.crt')]
    }

    plogo();
    https.createServer(httpsOptions, app).listen(app_port, () => {
        Clg.info(`Server is running at port ${app_port}`, `ServerStart:HTTPS`);
    })

    const wsServer = new WebSocketApp(config.httpServerUrl);
    wsServer.start();
} else {
    Clg.error('Err: Invalid run mode', `ServerStart`);
}

// 关闭服务器
process.on('SIGINT', async () => {
    Clg.info("Closing database connection pool...", `ServerClose`);
    if (db) {
        await db.close();
    }
    Clg.info("Server closed", `ServerClose`);
    process.exit(0);
});
