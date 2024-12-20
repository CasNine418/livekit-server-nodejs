/**
 * @file server.ts
 * @author  CasNine418
 * @createDate  2024-12-5
 * @lastEditors  CasNine418
 * @version 0.0.1
 */

import express, { NextFunction, Request, Response } from 'express';
import {
    AccessToken,
    RoomServiceClient,
    Room,
    ParticipantInfo,
    CreateOptions
} from 'livekit-server-sdk';

import Clg from '../utils/clg';
import config from '../app_options';
import { errorHandler } from '../middleware/errorhandler';
import DB from '../db';
import { decrypt, encrypt } from '../utils/crypto';
import { decodeTokenUser } from '../middleware/verifytoken';

const appKey = config.appKey;
const appSecret = config.appSecret;
const livekitHost = config.livekitHost;

const roomService = new  RoomServiceClient(livekitHost, appKey, appSecret);

const router = express.Router();

//------------------------------------------------------------------------------
// 业务函数

/**
 * 创建加入房间的Token，房间不存在时不允许
 * @param roomId 
 * @param identity 
 * @returns 
 */
const createTokenWhenRoomSet = async (roomId: string, identity: string) => {
    const at = new AccessToken(appKey, appSecret, {
        identity: identity,
        ttl: '10m'
    })
    at.addGrant({ roomJoin: false, room: roomId })

    return at.toJwt();
}

/**
 * 创建在LiveKit上的房间
 * @param roomCreateOptions
 * @returns 
 */
const createLivekitRoom = async (roomCreateOptions: CreateOptions) => {
    const opts = {
        name: roomCreateOptions.name,
        emptyTimeout: 10 * 60, // 10 minutes
        maxParticipants: roomCreateOptions.maxParticipants,
    };
    try {
        const room = await roomService.createRoom(opts);
        Clg.info(`Room ${room.name} created`, 'Server_createLivekitRoom');
        return room;
    } catch (err) {
        Clg.error(`Failed to create room ${roomCreateOptions.name}, ${err}`, 'Server_createLivekitRoom');
        throw err;
    }
}

/**
 * 删除在LiveKit上的房间
 * @param roomId 
 */
const deleteLiveKitRoom = async (roomId: string) => {
    try {
        await roomService.deleteRoom(roomId);
        Clg.info(`Room ${roomId} deleted`, 'Server_deleteLiveKitRoom');
        return roomId;
    } catch (err) {
        Clg.error(`Failed to delete room ${roomId}, ${err}`, 'Server_deleteLiveKitRoom');
        throw err; // 抛出错误以便调用者处理
    }
}

/**
 * 获取房间内所有用户
 * @param roomId 
 * @returns 
 */
const getRoomParticipants = async (roomId: string) => {
    try{
        const data = await roomService.listParticipants(roomId);
        return data;
    } catch {
        throw new Error('Failed to get room participants');
    }
}

const getLivekitRooms = async () => {
    try{
        const data = await roomService.listRooms();
        return data;
    } catch {
        throw new Error('Failed to get livekit rooms');
    }
}

//------------------------------------------------------------------------------

router.get('/rooms', (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(async () => {
            const db: DB = req.app.locals.db;

            if (!db) {
                throw new Error('Database connection not established');
            }

            db.query('SELECT * FROM voice_channels WHERE is_delete = 0;')
                .then((result) => {
                    return res.status(200).json(result);
                })
                .catch((err) => {
                    req.error_handler = {
                        location: 'Server_rooms',
                        originalError: err
                    };
                    next(err);
                });
        })
        .catch((err) => {
            req.error_handler = {
                location: 'Server_rooms',
                originalError: err
            };
            next(err);
        })
})

router.get('/rooms_livekit', (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(() => {
            getLivekitRooms()
                .then((result) => {
                    res.status(200).json(result);
                })
                .catch((err) => {
                    req.error_handler = {
                        location: 'Rooms_livekit',
                        originalError: err
                    }
                })
        })
        .catch((err) => {
            req.error_handler = {
                location: 'Rooms_livekit',
                originalError: err
            }
            next(err);
        })
})

router.post('/room_create_livekit', (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(async () => {
            const { room_id, max_participants, verifyData } = req.body;
            const token = req.headers.authorization?.split(' ')[1];

            if (!token) {
                return res.status(401).json({ error: 'Missing token' });
            }

            if (decrypt(verifyData) !== room_id) {
                return res.status(400).json({ error: 'Invalid request body' });
            }

            const decodedToken = decodeTokenUser(token);
            if (!decodedToken || !decodedToken.identity) {
                return res.status(401).json({ error: 'Invalid or missing token' });
            }
            const identity = decodedToken.identity;

            const db: DB = req.app.locals.db;
            if (!db) {
                throw new Error('Database connection not established');
            }

            // 验证用户 rank 是否大于等于 2
            const userRankResult = await db.query('SELECT rank FROM accounts WHERE identity = ?', [identity]);
            if (userRankResult.length === 0 || userRankResult[0].rank < 2) {
                return res.status(403).json({ error: 'Insufficient rank to create a room' });
            }

            const CreateOptions: CreateOptions = {
                name: room_id,
                maxParticipants: max_participants
            };
            if (room_id && max_participants) {
                createLivekitRoom(CreateOptions)
                    .then((result) => {
                        res.status(200).json({ message: `Room ${room_id} created`});
                    })
                    .catch((err) => {
                        res.status(400).json({ error: 'Failed to create room' });
                    });
            } else {
                res.status(400).json({ error: 'Invalid request body' });
            }
        })
        .catch((err) => {
            req.error_handler = {
                location: 'Room_create_livekit',
                originalError: err
            };
            next(err);
        });
});

router.post('/room_create', (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(async () => {
            const token = req.headers.authorization?.split(' ')[1];

            if (!token) {
                return res.status(401).json({ error: 'Missing token' });
            }

            const decodedToken = decodeTokenUser(token);
            if (!decodedToken || !decodedToken.identity) {
                return res.status(401).json({ error: 'Invalid or missing token' });
            }
            const identity = decodedToken.identity;

            const db: DB = req.app.locals.db;
            if (!db) {
                throw new Error('Database connection not established');
            }

            const userRankResult = await db.query('SELECT rank FROM accounts WHERE identity = ?', [identity]);
            if (userRankResult.length === 0 || userRankResult[0].rank < 2) {
                return res.status(403).json({ error: 'Insufficient rank to delete a room' });
            }

            const { name, rank, room_options }: { name: string, rank: number, room_options: object} = req.body;
            if (typeof name === 'string' && typeof rank === 'number' && typeof room_options === 'object') {
                db.query(`INSERT INTO \`voice_channels\` (\`id\`, \`name\`, \`rank\`, \`is_delete\`, \`created_at\`, \`updated_at\`, \`room_options\`) VALUES (NULL, ?, ?, '0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`, [name, rank, JSON.stringify(room_options)])
                    .then((result) => {
                        res.status(200).json({ message: 'Room created', result: result });
                    })
                    .catch((err) => {
                        req.error_handler = {
                            location: 'Room_create',
                            originalError: err
                        }
                        next(err);
                    })
            } else {
                res.status(400).json({ error: 'Invalid request body' });
                Clg.error('Invalid request body', 'Room_create');
            }
        })
})

router.delete('/room_delete_livekit', (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(async () => {
            const { room_id, secret } = req.body;
            const token = req.headers.authorization?.split(' ')[1];

            if (!token) {
                return res.status(401).json({ error: 'Missing token' });
            }

            if (secret !== config.deleteRoomSecret) {
                return res.status(400).json({ error: 'Invalid request body' });
            }

            const decodedToken = decodeTokenUser(token);
            if (!decodedToken || !decodedToken.identity) {
                return res.status(401).json({ error: 'Invalid or missing token' });
            }
            const identity = decodedToken.identity;

            const db: DB = req.app.locals.db;
            if (!db) {
                throw new Error('Database connection not established');
            }

            // 验证用户 rank 是否大于等于 2
            const userRankResult = await db.query('SELECT rank FROM accounts WHERE identity = ?', [identity]);
            if (userRankResult.length === 0 || userRankResult[0].rank < 2) {
                return res.status(403).json({ error: 'Insufficient rank to delete a room' });
            }

            deleteLiveKitRoom(room_id)
                .then((result) => {
                    res.status(200).json({ message: `Room ${room_id} deleted`, result: result });
                })
                .catch((err) => {
                    req.error_handler = {
                        location: 'Room_delete_livekit',
                        originalError: err
                    }
                    next(err);
                })
        })
        .catch((err) => {
            req.error_handler = {
                location: 'Room_delete',
                originalError: err
            };
            next(err);
        });
});

router.delete('/room_delete', (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(async () => {
            const { room_id } = req.body;
            const token = req.headers.authorization?.split(' ')[1];

            if (!token) {
                return res.status(401).json({ error: 'Missing token' });
            }

            const decodedToken = decodeTokenUser(token);
            if (!decodedToken || !decodedToken.identity) {
                return res.status(401).json({ error: 'Invalid or missing token' });
            }
            const identity = decodedToken.identity;

            const db: DB = req.app.locals.db;
            if (!db) {
                throw new Error('Database connection not established');
            }

            // 验证用户 rank 是否大于等于 2
            const userRankResult = await db.query('SELECT rank FROM accounts WHERE identity = ?', [identity]);
            if (userRankResult.length === 0 || userRankResult[0].rank < 2) {
                return res.status(403).json({ error: 'Insufficient rank to delete a room' });
            }

            db.query('UPDATE voice_channels SET is_delete = 1 WHERE id = ?', [room_id])
                .then((result) => {
                    res.status(200).json({ message: `Room ${room_id} deleted` });
                })
                .catch((err) => {
                    res.status(400).json({ error: 'Failed to delete room' });
                });
        })
        .catch((err) => {
            req.error_handler = {
                location: 'Room_delete',
                originalError: err
            };
            next(err);
        });
});

router.get('/room_join_token', (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(() => {
            const { room_id, identity } = req.query;

            const isRoomIdValid = typeof room_id === 'string' && /^\d+$/.test(room_id);
            if (isRoomIdValid && typeof identity === 'string') {
                createTokenWhenRoomSet(room_id, identity)
                    .then((token) => {
                        const encryptedData = encrypt(`
                            ${room_id}
                        `);
                        res.status(200).json({ token, verifyData: encryptedData });
                    })
                    .catch(err => {
                        req.error_handler = {
                            location: 'Room_join_token',
                            originalError: err
                        };
                        next(err);
                    });
            } else {
                res.status(400).json({ error: 'Invalid query parameters' });
            }
        })
        .catch((err) => {
            req.error_handler = {
                location: 'Room_join_token',
                originalError: err
            };
            next(err);
        });
});

router.get('/room_participants', (req: Request, res: Response<ParticipantInfo[]>, next: NextFunction) => {
    Promise.resolve()
        .then(() => {
            const roomId = req.query.room_id as string;
            getRoomParticipants(roomId)
                .then((result) => {
                    res.status(200).json(result);
                })
                .catch((err) => {
                    req.error_handler = {
                        location: 'Room_participants',
                        originalError: err
                    };
                    next(err);
                });
        })
        .catch((err) => {
            req.error_handler = {
                location: 'Room_participants',
                originalError: err
            };
            next(err);
        });
})

router.use(errorHandler)

export default router;