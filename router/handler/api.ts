/**
 * @file api.ts
 * @author  CasNine418
 * @createDate  2025-02-22
 * @lastEditors  CasNine418
 * @version 0.2.7
 */

import express, { NextFunction, Request, Response } from 'express';
import {
    AccessToken,
    RoomServiceClient,
    Room,
    ParticipantInfo,
    CreateOptions
} from 'livekit-server-sdk';

import config from '../../app_options';
import { v4 as uuid } from 'uuid';
import DB from '../../db';
import { ErrorCodeNumber, sendErrorResponse, sendOkResponse } from '../../utils/sendMessage';
import { Logger } from 'tslog'
import { decodeToken } from '../../middleware/verify';
import { decrypt, encrypt } from '../../utils/crypto';
const Log = new Logger({ name: 'api.ts' });

const appKey = config.appKey;
const appSecret = config.appSecret;
const livekitHost = config.livekitHost;

const roomService = new RoomServiceClient(livekitHost, appKey, appSecret);

const router = express.Router();

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
    at.addGrant({ roomJoin: true, room: roomId, roomCreate: false })

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
        Log.info(`Room ${room.name} created`);
        return room;
    } catch (err) {
        Log.error(`Failed to create room ${roomCreateOptions.name}, ${err}`);
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
        Log.info(`Room ${roomId} deleted`);
        return roomId;
    } catch (err) {
        Log.error(`Failed to delete room ${roomId}, ${err}`);
        throw err;
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

/**
 * 获取LiveKit存在的房间 
 * @returns 
 */
const getLivekitRooms = async () => {
    try{
        const data = await roomService.listRooms();
        return data;
    } catch(err) {
        throw new Error('Failed to get livekit rooms');
    }
}

const handleError = (res: Response, err: any, errorCode?: number) => {
    Log.error(`${err}`);
    sendErrorResponse(res, 500, 'Internal Server Error', errorCode ?? -1);
};

router.get('/rooms', (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(() => {
            const db: DB = req.app.locals.db;

            if (!db) {
                throw new Error('Database connection not established');
            }

            db.query('SELECT * FROM voice_channels WHERE is_delete = 0;')
                .then((result) => {
                    const fliter = result.map(({ password, ...rest } : { password: string }) => rest)
                    sendOkResponse(res, 'Rooms information retrieved successfully', fliter);
                })
                .catch((err) => {
                    handleError(res, err);
                });
        })
        .catch((err) => {
            handleError(res, err);
        });
});

router.get('/room/password/:secret/:roomId', (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(() => {
            const db: DB = req.app.locals.db;

            const secret = req.params.secret;
            if (secret !== config.roomPasswordSecret) {
                return sendErrorResponse(res, 401, 'Unauthorized', ErrorCodeNumber.InternalServerError);
            }

            if (!db) {
                throw new Error('Database connection not established');
            }

            // db.query('SELECT * FROM voice_channels WHERE is_delete = 0;')
            db.query('SELECT * FROM voice_channels WHERE is_delete = 0 AND uuid = ?;', [req.params.roomId])
                .then((result) => {
                    const { password, ...rest } = result[0];
                    sendOkResponse(res, 'Rooms information retrieved successfully', { password });
                })
                .catch((err) => {
                    handleError(res, err);
                });
        })
        .catch((err) => {
            handleError(res, err);
        });
});

router.get('/livekit/rooms', (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(() => {
            getLivekitRooms()
                .then((result) => {
                    sendOkResponse(res, 'Rooms information retrieved successfully', result);
                })
                .catch((err) => {
                    handleError(res, err);
                })
        })
        .catch((err) => {
            handleError(res, err);
        })
})

router.post('/rooms', (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(async () => {
            const token = req.headers.authorization?.split(' ')[1];

            if (!token) {
                return sendErrorResponse(res, 401, 'Unauthorized', ErrorCodeNumber.InvalidRequestBody);
            }

            const decodedToken = decodeToken(token);
            if (!decodedToken || !decodedToken.identity) {
                return sendErrorResponse(res, 401, 'Unauthorized', ErrorCodeNumber.InvalidRequestBody);
            }
            const identity = decodedToken.identity;

            const db: DB = req.app.locals.db;
            if (!db) {
                throw new Error('Database connection not established');
            }

            const userRankResult = await db.query('SELECT rank FROM accounts WHERE identity = ?', [identity]);
            if (userRankResult.length === 0 || userRankResult[0].rank < 2) {
                return sendErrorResponse(res, 403, 'Forbidden', ErrorCodeNumber.InvalidRequestBody);
            }

            const { name, rank, room_options, password }: { name: string, rank: number, room_options: object, password?: string } = req.body;
            if (typeof name === 'string' && typeof rank === 'number' && typeof room_options === 'object') {
                const roomUid = uuid();
                db.query(`INSERT INTO \`voice_channels\` (\`id\`, \`uuid\`, \`name\`, \`rank\`, \`password\`, \`is_delete\`, \`created_at\`, \`updated_at\`, \`room_options\`) VALUES (NULL, ?, ?, ?, '0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`, [roomUid, name, rank, password ?? null, JSON.stringify(room_options)])
                    .then((result) => {
                        sendOkResponse(res, 'Room created successfully', null);
                    })
                    .catch((err) => {
                        handleError(res, err, 500);
                    })
            } else {
                sendErrorResponse(res, 400, 'Invalid request body', ErrorCodeNumber.InvalidRequestBody);
                Log.error('Invalid request body');
            }
        })
        .catch((err) => {
            handleError(res, err, ErrorCodeNumber.InternalServerError);
        });
});

router.post('/livekit/rooms', (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(async () => {
            const { room_id, max_participants, verifyData } = req.body;
            const token = req.headers.authorization?.split(' ')[1];
            if (!token) {
                return sendErrorResponse(res, 401, 'Unauthorized', ErrorCodeNumber.InvalidRequestBody);
            }

            if (decrypt(verifyData) !== room_id) {
                return sendErrorResponse(res, 400, 'Invalid request body', ErrorCodeNumber.InvalidRequestBody);
            }

            const decodedToken = decodeToken(token);
            if (!decodedToken || !decodedToken.identity) {
                return sendErrorResponse(res, 401, 'Unauthorized', ErrorCodeNumber.InvalidRequestBody);
            }
            const identity = decodedToken.identity;

            const db: DB = req.app.locals.db;
            if (!db) {
                throw new Error('Database connection not established');
            }

            const userRankResult = await db.query('SELECT rank FROM accounts WHERE identity = ?', [identity]);
            if (userRankResult.length === 0 || userRankResult[0].rank < 0) {
                return sendErrorResponse(res, 403, 'Forbidden', ErrorCodeNumber.InvalidRequestBody);
            }

            const CreateOptions: CreateOptions = {
                name: room_id,
                maxParticipants: max_participants
            };
            if (room_id && max_participants) {
                createLivekitRoom(CreateOptions)
                    .then((result) => {
                        sendOkResponse(res, 'Room created successfully', null);
                    })
                    .catch((err) => {
                        sendErrorResponse(res, 400, 'Error creating room', ErrorCodeNumber.InvalidRequestBody);
                    });
            } else {
                sendErrorResponse(res, 400, 'Invalid request body', ErrorCodeNumber.InvalidRequestBody);
            }
        })
        .catch((err) => {
            handleError(res, err, ErrorCodeNumber.InternalServerError);
        });
});

router.delete('/rooms/:roomId', (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(async () => {
            const { roomId } = req.params;
            const token = req.headers.authorization?.split(' ')[1];

            if (!token) {
                return sendErrorResponse(res, 401, 'Unauthorized', ErrorCodeNumber.InvalidRequestBody);
            }

            const decodedToken = decodeToken(token);
            if (!decodedToken || !decodedToken.identity) {
                return sendErrorResponse(res, 401, 'Unauthorized', ErrorCodeNumber.InvalidRequestBody);
            }
            const identity = decodedToken.identity;

            const db: DB = req.app.locals.db;
            if (!db) {
                throw new Error('Database connection not established');
            }

            const userRankResult = await db.query('SELECT rank FROM accounts WHERE identity = ?', [identity]);
            if (userRankResult.length === 0 || userRankResult[0].rank < 2) {
                return sendErrorResponse(res, 403, 'Forbidden', ErrorCodeNumber.InvalidRequestBody);
            }

            db.query('UPDATE voice_channels SET is_delete = 1 WHERE id = ?', [roomId])
                .then((result) => {
                    sendOkResponse(res, 'Room deleted successfully', null);
                })
                .catch((err) => {
                    sendErrorResponse(res, 400, 'Error deleting room', ErrorCodeNumber.InvalidRequestBody);
                });
        })
        .catch((err) => {
            handleError(res, err, ErrorCodeNumber.InternalServerError);
        });
});

router.delete('/livekit/rooms/:roomId', (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(async () => {
            const { secret } = req.body;
            const { roomId } = req.params;
            const token = req.headers.authorization?.split(' ')[1];

            if (!token) {
                return sendErrorResponse(res, 401, 'Unauthorized', ErrorCodeNumber.InvalidRequestBody);
            }

            if (secret !== config.deleteRoomSecret) {
                return sendErrorResponse(res, 400, 'Invalid request body', ErrorCodeNumber.InvalidRequestBody);
            }

            const decodedToken = decodeToken(token);
            if (!decodedToken || !decodedToken.identity) {
                return sendErrorResponse(res, 401, 'Unauthorized', ErrorCodeNumber.InvalidRequestBody);
            }
            const identity = decodedToken.identity;

            const db: DB = req.app.locals.db;
            if (!db) {
                throw new Error('Database connection not established');
            }

            const userRankResult = await db.query('SELECT rank FROM accounts WHERE identity = ?', [identity]);
            if (userRankResult.length === 0 || userRankResult[0].rank < 2) {
                return sendErrorResponse(res, 403, 'Forbidden', ErrorCodeNumber.InvalidRequestBody);
            }

            deleteLiveKitRoom(roomId)
                .then((result) => {
                    sendOkResponse(res, 'Room deleted successfully', null);
                })
                .catch((err) => {
                    handleError(res, err, ErrorCodeNumber.InternalServerError);
                })
        })
        .catch((err) => {
            handleError(res, err, ErrorCodeNumber.InternalServerError);
        });
});

router.get('/rooms/:roomId/token', (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(() => {
            const { identity } = req.query;
            const { roomId } = req.params;

            const isRoomIdValid = typeof roomId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roomId);
            if (isRoomIdValid && typeof identity === 'string') {
                createTokenWhenRoomSet(roomId, identity)
                    .then((token) => {
                        const encryptedData = encrypt(`
                            ${roomId}
                        `);
                        sendOkResponse(res, 'Room join token created', { token, encryptedData });
                    })
                    .catch(err => {
                        handleError(res, err, ErrorCodeNumber.InternalServerError);
                    });
            } else {
                sendErrorResponse(res, 400, 'Invalid request body', 400);
            }
        })
        .catch((err) => {
            handleError(res, err, ErrorCodeNumber.InternalServerError);
        });
});

router.get('/rooms/:roomId/participants', (req: Request, res: Response<object>, next: NextFunction) => {
    Promise.resolve()
        .then(() => {
            const { roomId } = req.params;
            getRoomParticipants(roomId)
                .then((result) => {
                    sendOkResponse(res, `Room participants fetched`, result);
                })
                .catch((err) => {
                    handleError(res, err, ErrorCodeNumber.InternalServerError);
                });
        })
        .catch((err) => {
            handleError(res, err, ErrorCodeNumber.InternalServerError);
        });
})

export default router;