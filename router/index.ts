import express, { Request, Response } from 'express';
import DB from '../db';
import api from './handler/api';
import auth from './handler/auth';
import { verify } from '../middleware/verify';
import config from '../app_options';
import { sendOkResponse } from '../utils/sendMessage';

const start_time = Date.now();

class AppRouter {
    private app: express.Application;
    private db: DB;

    constructor(app: express.Application, db: DB) {
        this.app = app;
        this.db = db;
    }

    public setupRoutes() {
        this.app.use('/v1/auth', auth);
        this.app.use('/v1/api', verify, api);

        this.app.get('/token', verify, (req, res) => {
            sendOkResponse(res, 'ok', {});
        })

        this.app.get('/', (req, res) => {
            res.send('<pre>OK</pre>')
        })

        this.app.get('/status', (req, res) => {
            sendOkResponse(res, 'ok', {
                version: config.version,
                start_time: start_time,
            })
        })
    }
}

export default AppRouter;