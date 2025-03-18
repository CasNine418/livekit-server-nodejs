import express, { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { Logger } from 'tslog';
const Log = new Logger({ name: 'auth.ts' });
import DB from '../../db';
import config from '../../app_options';
import { ErrorCodeNumber, sendErrorResponse, sendOkResponse } from '../../utils/sendMessage';
import { hashPassword, verifyPassword } from '../../middleware/verify';

const router = express.Router();

interface LoginRequestBody {
    identity: string;
    password: string;
}

router.post('/login', (req: Request<{}, {}, LoginRequestBody>, res: Response, next: NextFunction) => {
    const db: DB = req.app.locals.db;

    if (!db) {
        Log.error('Database connection not established');
        sendErrorResponse(res, 500, 'Internal Server Error', ErrorCodeNumber.InternalServerError);
    } else {
        const { identity, password } = req.body;

        if (!identity || !password) {
            Log.error('Invalid request body');
            return sendErrorResponse(res, 400, 'Invalid request body', ErrorCodeNumber.InvalidRequestBody);
        } else {
            try {
                let sql = 'SELECT * FROM accounts WHERE identity = ?';

                db.query(sql, [identity])
                    .then((result: any) => {
                        if (result.length > 0) {
                            verifyPassword(password, result[0].password)
                                .then((isVaild: boolean) => {
                                    if (isVaild) {
                                        const token = jwt.sign(
                                            { identity: identity },
                                            config.jwtSecretKey,
                                            { expiresIn: '24h' }
                                        );
                                        Log.info(`${identity} login success`)
                                        return sendOkResponse(res, 'Login Success', { access_token: token });
                                    } else {
                                        Log.error(`${identity} login failed`)
                                        return sendErrorResponse(res, 401, 'Unauthorized', 401)
                                    }
                                }).catch((err) => {
                                    Log.error(err);
                                    return sendErrorResponse(res, 500, 'Internal Server Error', 500)
                                })
                        } else {
                            return sendErrorResponse(res, 400, 'Invalid request body', ErrorCodeNumber.InvalidRequestBody);
                        }
                    });
            } catch (err) {
                Log.error(err);
                return sendErrorResponse(res, 500, 'Internal server error', ErrorCodeNumber.InternalServerError);
            }
        }
    }
});

router.post('/refresh', (req: Request, res: Response) => {
    const { access, identity } = req.body;

    jwt.verify(access, config.jwtSecretKey, (err: any, user: any) => {
        if (err) {
            return sendErrorResponse(res, 401, 'Invalid token', 401);
        }

        const longToken = jwt.sign(
            { identity: identity },
            config.jwtSecretKey,
            { expiresIn: '7d' }
        );

        sendOkResponse(res, 'Token refreshed', { refresh_token: longToken });
    });
});

router.post('/register', async (req: Request, res: Response) => {
    const db: DB = req.app.locals.db;

    if (!db) {
        Log.error('Database connection not established');
        sendErrorResponse(res, 500, 'Internal Server Error', ErrorCodeNumber.InternalServerError);
    } else {
        const { identity, password } = req.body;

        if (!identity || !password) {
            Log.error('Invalid request body');
            res.status(400).json({ message: 'Invalid request body' });
        } else {
            let sqlSearchIdentity = 'SELECT * FROM accounts WHERE identity = ?';

            db.query(sqlSearchIdentity, [identity])
                .then((result) => {
                    if (result.length > 0) {
                        return sendErrorResponse(res, 409, 'Identity already exists', ErrorCodeNumber.UserAlreadyExists);
                    } else {
                        hashPassword(password)
                            .then((returnedHash) => {
                                let hashedPassword = returnedHash;
                                const sqlRegister = `INSERT INTO accounts (identity, username, password) VALUES (?, ?, ?);`;
                                db.query(sqlRegister, [identity, identity, hashedPassword])
                                    .then((result) => {
                                        Log.info(`${identity} registered success`);
                                        return sendOkResponse(res, 'User registered successfully', {})
                                    })
                                    .catch((err) => {
                                        Log.error(`Error registering ${err}`);
                                        return sendErrorResponse(res, 500, 'Error registering user', ErrorCodeNumber.ErrorRegisteringUser);
                                    })
                            })
                            .catch((err) => {
                                Log.error(`Error registering user: ${err}`);
                                return sendErrorResponse(res, 500, 'Error registering user', ErrorCodeNumber.ErrorRegisteringUser);
                            })

                    }
                })
        }
    }
})

router.get('/user/info/:identity', (req: Request, res: Response) => {
    const db: DB = req.app.locals.db;

    if(!db) {
        Log.error('Database connection not established');
        sendErrorResponse(res, 500, 'Internal Server Error', ErrorCodeNumber.InternalServerError);
    } else {
        const { identity } = req.params;

        if(!identity) {
            Log.error('Invalid request body');
            sendErrorResponse(res, 400, 'Invalid request body', ErrorCodeNumber.InvalidRequestBody);
        }

        db.query('SELECT * FROM accounts WHERE identity = ?', [identity])
            .then((result) => {
                const dataWithoutPersonalInfo = result.map((item: any) => {
                    const { password, phone, status, email, ...rest } = item;
                    return rest;
                });
                return sendOkResponse(res, 'Success', dataWithoutPersonalInfo);
            })
            .catch((err) => {
                Log.error('Error occurred while querying user information');
                return sendErrorResponse(res, 500, 'Internal Server Error', ErrorCodeNumber.ErrorOccurredWhileQueryingUserInformation);
            });
    }
})

router.get('/server/info', (req: Request, res: Response) => {
    return sendOkResponse(res, 'Success', {
        wsport: config.wss_port,
        name: config.server_name,
        uid: config.server_uid,
        status: config.server_status,
        description: config.server_description,
        avatar: config.server_avatar,
        banner: config.server_banner,
        start: config.server_start
    });
})

export default router;
