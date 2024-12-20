import express, { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import jwt from 'jsonwebtoken';

import Clg from '../utils/clg';
import DB from '../db';
import { hashPassword, verifyPassword } from '../utils/password';

import config from '../app_options';

const router = express.Router();

// 注册
router.post('/register', async (req: Request, res: Response) => {
    const db: DB = req.app.locals.db;

    if(!db) {
        Clg.error('DB is not initialized', 'user.ts');
    } else {
        const { identity, password } = req.body;

        if(!identity || !password) {
            Clg.error('Invalid request body', 'user.ts');
            res.status(400).json({ message: 'Invalid request body' });
        } else {
            let sqlSearchIdentity = 'SELECT * FROM accounts WHERE identity = ?';

        db.query(sqlSearchIdentity, [identity])
            .then((result) => {
                if (result.length > 0) {
                    return res.status(409).json({ message: 'Identity already exists' });
                } else {
                    // let hashedPassword  = '';
                    hashPassword(password)
                        .then((returnedHash) => {
                            let hashedPassword = returnedHash;
                            const sqlRegister = `INSERT INTO accounts (identity, username, password) VALUES (?, ?, ?);`;
                            db.query(sqlRegister, [identity, identity, hashedPassword])
                                .then((result) => {
                                    Clg.info(`User ${identity} registered successfully`, 'user.ts');
                                    return res.status(201).json({ message: 'User registered successfully' });
                                })
                                .catch((err) => {
                                    Clg.error(`Error registering user: ${err}`, 'user.ts');
                                    return res.status(500).json({ message: 'Error registering user' });
                                })
                        })
                        .catch((err) => {
                            Clg.error(`Error registering user: ${err}`, 'user.ts');
                            return res.status(500).json({ message: 'Error registering user' });
                        })

                }
            })
        }
    }
})

// 登录
router.post('/login', (req: Request, res: Response) => {
    const db: DB = req.app.locals.db;

    if(!db) {
        Clg.error('DB is not initialized', 'user.ts');
    } else {
        const { identity, password } = req.body;

        if(!identity || !password) {
            Clg.error('Invalid request body', 'user.ts');
            res.status(400).json({ message: 'Invalid request body' });
        } else {
        let sqlSearchIdentity = 'SELECT * FROM accounts WHERE identity = ?';

        db.query(sqlSearchIdentity, [identity])
            .then((result) => {
                if(result.length > 0) {
                    verifyPassword(password, result[0].password)
                        .then((isValidPassword) => {
                            if(isValidPassword) {
                                const token = jwt.sign(
                                    { identity: identity },
                                    config.jwtSecretKey,
                                    { expiresIn: config.expiresIn }
                                );
                                Clg.info(`User ${identity} logged in successfully`, 'user.ts');
                                res.status(200).json({
                                    message: 'User logged in successfully',
                                    apiToken: token,
                                    identity: identity
                                });
                            } else {
                                Clg.error(`Invalid password for user ${identity}`, 'user.ts');
                                return res.status(401).json({ message: 'Invalid password' });
                            }
                        })
                        .catch((err) => {
                            Clg.error(`Error verifying password for user ${identity}: ${err}`, 'user.ts');
                            return res.status(500).json({ message: 'Error verifying password' });
                        })
                }
            })
            .catch((err) => {
                Clg.error(`Error logging in user: ${err}`, 'user.ts');
                return res.status(500).json({ message: 'Error logging in user' });
            })
        }
    }
})

router.post('/admin_login', (req: Request, res: Response) => {
    const db: DB = req.app.locals.db;

    if(!db) {
        Clg.error('DB is not initialized', 'user.ts');
    } else {
        const { identity, password } = req.body;

        if(!identity || !password) {
            Clg.error('Invalid request body', 'user.ts');
            res.status(400).json({ message: 'Invalid request body' });
        } else {
        let sqlSearchIdentity = 'SELECT * FROM accounts WHERE identity = ?';

        db.query(sqlSearchIdentity, [identity])
            .then((result) => {
                if(result.length > 0) {
                    verifyPassword(password, result[0].password)
                        .then((isValidPassword) => {
                            if(isValidPassword) {
                                const token = jwt.sign(
                                    { identity: identity },
                                    config.jwtSecretKey,
                                    { expiresIn: '365d' }
                                );
                                Clg.info(`User ${identity} logged in successfully`, 'user.ts');
                                res.status(200).json({
                                    message: 'User logged in successfully',
                                    apiToken: token,
                                    identity: identity
                                });
                            } else {
                                Clg.error(`Invalid password for user ${identity}`, 'user.ts');
                                return res.status(401).json({ message: 'Invalid password' });
                            }
                        })
                        .catch((err) => {
                            Clg.error(`Error verifying password for user ${identity}: ${err}`, 'user.ts');
                            return res.status(500).json({ message: 'Error verifying password' });
                        })
                }
            })
            .catch((err) => {
                Clg.error(`Error logging in user: ${err}`, 'user.ts');
                return res.status(500).json({ message: 'Error logging in user' });
            })
        }
    }
})

// 重设密码
router.post('/reset_password', (req: Request, res: Response) => {
    const db: DB = req.app.locals.db;

    if(!db) {
        Clg.error('DB is not initialized', 'user.ts');
    } else {
        const { identity, oldPassword, newPassword } = req.body;

        if(!identity || !oldPassword || !newPassword) {
            Clg.error('Invalid request body', 'user.ts');
        }
    }
})

// 查询用户信息
router.get('/user_info', (req: Request, res: Response) => {
    const db: DB = req.app.locals.db;

    if(!db) {
        Clg.error('DB is not initialized', 'user.ts');
    } else {
        const { identity } = req.query;

        if(!identity) {
            Clg.error('Invalid request body', 'user.ts');
        }

        db.query('SELECT * FROM accounts WHERE identity = ?', [identity])
            .then((result) => {
                const dataWithoutPersonalInfo = result.map((item: any) => {
                    const { password, phone, status, email, ...rest } = item;
                    return rest;
                });

                return res.status(200).json(dataWithoutPersonalInfo);
            })
            .catch((err) => {
                Clg.error('Error occurred while querying user information', 'user.ts');
            });
    }
})

export default router;