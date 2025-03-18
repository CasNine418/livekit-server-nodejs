/**
 * @file ws/index.ts
 * @author  CasNine418
 * @createDate  2025-02-22
 * @lastEditors  CasNine418
 * @version 0.0.1
 */

import { z } from "zod";
import ws, { WebSocket } from 'ws';
import express, { NextFunction, Request, Response } from 'express';
import { WebhookEvent, WebhookReceiver } from "livekit-server-sdk";
import config from '../app_options';
import https from 'https';
import axiosuni from 'axios';
const axios = axiosuni.create({
    httpsAgent: new https.Agent({
        rejectUnauthorized: false,
    }),
});
import path from 'path';
import fs, { readFileSync } from 'fs';
import { Logger } from 'tslog';
import { IncomingMessage } from "http";
import { decodeToken } from "../middleware/verify";
import { UserSymplyType } from "./type";
import { parseQueryParams } from "../utils/params";
import { 
    LivekitRoomSchema, 
    PreJoinRoomMessageSchema, 
    RoomMappingSchema, 
    ApiRoomsResponseType, 
    WsMessageSchema, 
    WsResponseSchema, 
    ApiGetRoomTokenResponseType, 
    JoinRoomMessageSchema, 
    QuitRoomMessageSchema,
    PostRoomMessageSchema,
    DeleteRoomMessageSchema
} from "./schemas";
import deepcopy from "../utils/deepCopy";
const Log = new Logger({ name: 'ws.ts' });

interface UserConnection {
    ws: WebSocket;
    user: UserSymplyType['identity'];
    // sessionId: string;
    ip: string;
    connectedAt: Date;
    lastActivity: Date;
    metaData?: Record<string, unknown>;
    heartbeatInterval?: NodeJS.Timeout;
}

interface RoomParticipants {
    [roomId: string]: RoomMemberStatus[];
}

interface RoomMapping {
    [roomId: string]: string | undefined; // roomId -> livekitRoomName
}

interface RoomMemberStatus {
    user: UserSymplyType;
    status: 0 | 1 | 2 ; // 0: 正在加入, 1: 加入成功,
    updateTime: number;
    timerId?: NodeJS.Timeout;
}


const receiver = new WebhookReceiver(config.appKey, config.appSecret);

const router = express.Router();

router.use('/server/endpoint', express.raw({type: 'application/webhook+json'}));

router.post('/server/endpoint', async (req, res) => {
    try {
        const event: WebhookEvent = await receiver.receive(req.body, req.get('Authorization'));
    } catch (error) {
        Log.error('Failed to process webhook:', error);
    }
});

class WebSocketServer {
    private httpServerUrl = config.httpServerUrl;
    private onlineUsers = new Map<string, UserConnection>();
    private serverRoomInfo = new Map<string, z.infer<typeof ApiRoomsResponseType>>();;
    private serverRoomMapping: RoomMapping = {};
    private serverRoomParticipants: RoomParticipants = {};
    private startedAt = Date.now();
    constructor () {
        
    }

    private rejectConnection(ws: WebSocket, reason: string, code?: number) {
        ws.close(code ?? 1008, reason);
    }

    private sendWsResponse(ws: WebSocket, wss: ws.Server, data: z.infer<typeof WsResponseSchema>) {
        ws.send(JSON.stringify(data));
    }

    private sendWssClientBoardcast(wss: ws.Server, data: z.infer<typeof WsResponseSchema>) {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            } else {
                Log.error('Client is not connected');
                client.terminate();
            }
        });
    }

    private sendNormalError(ws: WebSocket) {
        ws.send(JSON.stringify({
            event: 'ERROR',
            payload: {
                error: 'Internal Server Error'
            },
            timestamp: Date.now()
        }))
    }

    private sendWelcomeMessage(ws: WebSocket) {
        ws.send(JSON.stringify({
            event: 'WELCOME',
            payload: {
                message: 'Welcome to the server',
                server: {
                    ws: config.server_api,
                    name: config.server_name,
                    uid: config.server_uid,
                    status: config.server_status,
                    start: this.startedAt,
                    description: config.server_description,
                    avatar: config.server_avatar,
                    banner: config.server_banner,
                }
            },
            timestamp: Date.now()
        }));
    }

    private initRoomMapping(re: number = 3, delay: number = 2000) {
        this.getRooms(config.serverAdminToken)
            .then((result) => {
                if (result.event === 'GET_ROOMS') {
                    this.serverRoomMapping = result.payload.mapping;
                    const parsedRooms = result.payload.rooms.map(room => 
                        ApiRoomsResponseType.parse(room)
                    );
                    parsedRooms.forEach(room => {
                        this.serverRoomInfo.set(room.uuid, room);
                    });
                    Log.info('Room mapping initialized');
                } else {
                    Log.error('Failed to initialize room mapping');
                    if (re > 0) {
                        setTimeout(() => this.initRoomMapping(re - 1, delay), delay);
                    } else {
                        Log.error('Failed to initialize room mapping');
                        process.exit(1);
                    }
                }
            }).catch(error => {
                Log.error(error);
                if (re > 0) {
                    setTimeout(() => this.initRoomMapping(re - 1, delay), delay);
                } else {
                    Log.error('Failed to initialize room mapping');
                    process.exit(1);
                }
            })
    }

    private async getRooms(token: string): Promise<z.infer<typeof WsResponseSchema>> {
        try {
            const roomsResponse = await axios.get<{ data: typeof ApiRoomsResponseType[] }>(
                `${this.httpServerUrl}/v1/api/rooms`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            const roomsData = roomsResponse.data?.data || [];

            const safeParseRoom = (raw: any) => {
                // 深度处理 options 对象
                const processOptions = (options: any) => ({
                    name: options?.name || `${raw.uuid}`,
                    maxParticipants: options?.maxParticipants || 20,
                    ...options
                });

                return {
                    ...raw,
                    id: String(raw.id),
                    create_at: raw.create_at ?? raw.created_at ?? new Date().toISOString(),
                    options: processOptions(JSON.parse(raw.options) || {})
                }
            };
            const rooms = roomsData.map(room => 
                ApiRoomsResponseType.parse(safeParseRoom(room)) // 先预处理再验证
            );
            
            const livekitRoomsResponse = await axios.get<{ data: typeof LivekitRoomSchema[] }>(
                `${this.httpServerUrl}/v1/api/livekit/rooms`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
          
            const livekitData = livekitRoomsResponse.data?.data || [];
            const livekitRooms = livekitData.map(room => LivekitRoomSchema.parse(room));    

            if (rooms && livekitRooms) {
                let roomMapping: Record<string, string | undefined> = RoomMappingSchema.parse({});

                rooms.forEach(room => {
                    const livekitRoom = livekitRooms.find(lkRoom => lkRoom.name === String(room.id));
                    roomMapping[room.id] = livekitRoom ? livekitRoom.name : undefined;
                });

                return WsResponseSchema.parse({
                    event: 'GET_ROOMS',
                    payload: {
                        rooms: rooms,
                        livekit: livekitRooms,
                        mapping: roomMapping
                    },
                    timestamp: Date.now()
                })
            } else {
                throw new Error('Internal Server Error');
            }
        } catch (error) {
            if (error instanceof z.ZodError) {
                Log.error('Zod validation error:', error.issues);
            } else {
                Log.error('Error fetching rooms:');
            }
            return WsResponseSchema.parse({
                event: 'GET_ROOMS_FAIL',
                timestamp: Date.now(),
                payload: {
                    error: 'Failed to fetch rooms'
                }
            });
        }
    }

    private async getParticipants(token: string): Promise<z.infer<typeof WsResponseSchema>> {
        try {
            const copy = deepcopy(this.serverRoomParticipants);

            function removeTimerIds(participants: RoomParticipants) {
                for (const key in participants) {
                    if (Array.isArray(participants[key])) {
                        participants[key] = participants[key].map(item => {
                            const { timerId, ...rest } = item;
                            return rest;
                        });
                    }
                }
                return participants;
            }
            
            return WsResponseSchema.parse({
                event: 'GET_PARTICIPANTS',
                timestamp: Date.now(),
                payload: {
                    participants: removeTimerIds(copy)
                }
            })
        } catch (error) {
            return WsResponseSchema.parse({
                event: 'GET_PARTICIPANTS_FAIL',
                timestamp: Date.now(),
                payload: {
                    error: 'Failed to fetch participants'
                }
            });
        }
    }

    private async handleJoinRoom(ws: WebSocket, wss: ws.Server, res: z.infer<typeof PreJoinRoomMessageSchema>) {
        try {
            const data = PreJoinRoomMessageSchema.parse(res)

            const roomId = data.payload.roomId;
            const userInfo = data.payload.userInfo;

            const roomPassword = data.payload.roomPassword ?? null;

            for (const currentRoomId in this.serverRoomParticipants) {
                if (currentRoomId !== roomId) {
                    const participants = this.serverRoomParticipants[currentRoomId];
                    const memberIndex = participants.findIndex(member => member.user.uid === userInfo.uid);
                    if (memberIndex !== -1) {
                        const memberStatus = participants[memberIndex];
                        if (memberStatus.status === 0) {
                            if (memberStatus.timerId) {
                                clearTimeout(memberStatus.timerId);
                            }
                            participants.splice(memberIndex, 1);
                            Log.info(`${userInfo.identity} removed from ${currentRoomId}: Joining another room`)
                        }
                    }
                }
            }

            if (roomPassword) {
                const passwordRes = await axios.get<{
                    message: string,
                    data: {
                        password: string
                    },
                    metadata: object
                }>(`${this.httpServerUrl}/v1/api/room/password/${config.roomPasswordSecret}/${roomId}`, 
                    { headers: { Authorization: `Bearer ${res.payload.token}` } }
                );

                if (passwordRes.data.data.password !== null && passwordRes.data.data.password !== roomPassword) {
                    this.sendWsResponse(ws, wss, {
                        event: 'PRE_JOIN_ROOM_FAIL',
                        timestamp: Date.now(),
                        payload: {
                            error: 'Need password'
                        }
                    })
                    Log.error(`${userInfo.identity} failed to join ${roomId}: Wrong password`);
                    return;
                }
            }

            if (!this.serverRoomParticipants[roomId]) {
                this.serverRoomParticipants[roomId] = [];
            }

            const memberStatus: RoomMemberStatus = {
                user: userInfo,
                status: 0,
                updateTime: Date.now()
            }

            this.serverRoomParticipants[roomId].push(memberStatus);

            const timeoutDuration = 60000;
            memberStatus.timerId = setTimeout(() => {
                const memberIndex = this.serverRoomParticipants[roomId].findIndex(member => member.user.uid === userInfo.uid);
                if (memberIndex !== -1 && this.serverRoomParticipants[roomId][memberIndex].status < 2) {
                    this.serverRoomParticipants[roomId].splice(memberIndex, 1);
                    Log.info(`${userInfo.identity} removed from ${roomId}: Timeout`);
                }
            }, timeoutDuration);

            try {
                const result = await axios.get<z.infer<typeof ApiGetRoomTokenResponseType>>(
                    `${this.httpServerUrl}/v1/api/rooms/${roomId}/token?identity=${userInfo.identity}`,
                    {
                        headers: {
                            Authorization: `Bearer ${data.payload.token}`
                        }
                    }
                );

                if (result.status === 200) {
                    const lkToken = result.data.data.token;
                    const vdata = result.data.data.encryptedData;

                    const memberIndex = this.serverRoomParticipants[roomId].findIndex(member => member.user.uid === userInfo.uid);
                    if (memberIndex !== -1) {
                        this.serverRoomParticipants[roomId][memberIndex].status = 1;
                        this.serverRoomParticipants[roomId][memberIndex].updateTime = Date.now();
                    }

                    const isRoomCreated = (roomId: string) => {
                        return this.serverRoomMapping[roomId] !== undefined;
                    }

                    if (!isRoomCreated(roomId) && this.serverRoomInfo.has(roomId)) {
                        const createRequest = JSON.stringify({
                            room_id: roomId,
                            max_participants: this.serverRoomInfo.get(roomId)?.options?.maxParticipants ?? 20,
                            verify: vdata
                        })

                        const afterResult = await axios.post(
                            `${this.httpServerUrl}/v1/api/rooms/livekit`,
                            createRequest,
                            {
                                headers: {
                                    'Authorization': `Bearer ${res.payload.token}`,
                                    'Content-Type': 'application/json'
                                }
                            }
                        )

                        if (afterResult.status === 200) {
                            this.sendWsResponse(ws, wss, {
                                event: 'PRE_JOIN_ROOM',
                                timestamp: Date.now(),
                                payload: {
                                    type: 'AFTER_CREATE',
                                    room: roomId,
                                    roomToken: lkToken,
                                    host: config.livekitHost
                                }
                            })

                            function removeTimerIds(participants: RoomParticipants) {
                                for (const key in participants) {
                                    if (Array.isArray(participants[key])) {
                                        participants[key] = participants[key].map(item => ({
                                            ...item,
                                            timerId: undefined
                                        }));
                                    }
                                }
                                return participants;
                            }

                            this.sendWssClientBoardcast(wss, {
                                event: 'CLIENT_PRE_JOIN_ROOM_BOARDCAST',
                                payload: {
                                    sender: res.payload.userInfo.identity,
                                    userInfo: res.payload.userInfo,
                                    roomId: roomId,
                                    participants: removeTimerIds(this.serverRoomParticipants)
                                }
                            })

                            this.initRoomMapping();
                        } else {
                            Log.error(`Failed to create room: ${roomId}`);
                            this.sendWsResponse(ws, wss, {
                                event: 'PRE_JOIN_ROOM_FAIL',
                                timestamp: Date.now(),
                                payload: {
                                    error: 'Failed to create room'
                                }
                            })
                        }
                    } else {
                        this.sendWsResponse(ws, wss, {
                            event: 'PRE_JOIN_ROOM',
                            timestamp: Date.now(),
                            payload: {
                                type: 'DIRECT',
                                room: roomId,
                                roomToken: lkToken,
                                host: config.livekitHost
                            }
                        })
                    }
                } else {
                    Log.error(`Failed to get room token: ${roomId}`);
                    this.sendWsResponse(ws, wss, {
                        event: 'PRE_JOIN_ROOM_FAIL',
                        timestamp: Date.now(),
                        payload: {
                            error: 'Failed to get room token'
                        }
                    });
                }
            } catch (error) {
                Log.error(error);
                this.sendWsResponse(ws, wss, {
                    event: 'PRE_JOIN_ROOM_FAIL',
                    payload: {
                        error: 'Internal server error'
                    },
                    timestamp: Date.now()
                })
            }
        } catch (error) {
            Log.error(error);
            this.sendWsResponse(ws, wss, {
                event: 'PRE_JOIN_ROOM_FAIL',
                payload: {
                    error: 'Internal server error'
                },
                timestamp: Date.now()
            })
        }     
    }

    private clientCurrentJoinRoom(ws: WebSocket, wss: ws.Server, res: z.infer<typeof JoinRoomMessageSchema>) {
        try {
            const userInfo = res.payload.userInfo;
            const roomId = res.payload.roomId;

            if (this.serverRoomParticipants[roomId]) {
                const memberIndex = this.serverRoomParticipants[roomId].findIndex(member => member.user.uid === userInfo.uid);
                if (memberIndex !== -1) {
                    const m = this.serverRoomParticipants[roomId][memberIndex];

                    m.timerId ? clearTimeout(m.timerId) : null;

                    m.status = 2;
                    m.updateTime = Date.now();

                    this.sendWssClientBoardcast(wss, {
                        event: 'CLIENT_JOIN_ROOM_BOARDCAST',
                        payload: {
                            sender: userInfo.identity,
                            token: '',
                            userInfo: userInfo,
                            roomId: roomId
                        }
                    })
                } else {
                    Log.error(`Failed to find member: ${userInfo.uid} in room: ${roomId}`);
                    this.sendWsResponse(ws, wss, {
                        event: 'JOIN_ROOM_FAIL',
                        timestamp: Date.now(),
                        payload: {
                            error: 'Failed to find member'
                        }
                    });
                }
            } else {
                Log.error(`Failed to find room: ${roomId}`);
                this.sendWsResponse(ws, wss, {
                    event: 'JOIN_ROOM_FAIL',
                    timestamp: Date.now(),
                    payload: {
                        error: 'Failed to find room'
                    }
                });
            }

        } catch (error) {
            Log.error(error);
            this.sendWsResponse(ws, wss, {
                event: 'JOIN_ROOM_FAIL',
                payload: {
                    error: 'Internal server error'
                },
                timestamp: Date.now()
            })
        }
    }

    private clientQuitRoom(ws: WebSocket, wss: ws.Server, res: z.infer<typeof QuitRoomMessageSchema>) {
        try {
            const userInfo = res.payload.userInfo;

            this.onlineUsers.delete(userInfo.identity);

            for (const  roomId in this.serverRoomParticipants) {
                const p = this.serverRoomParticipants[roomId];
                const index = p.findIndex(member => member.user.uid === userInfo.uid);
                if (index !== -1) {
                    const m = p[index];
                    if (m.timerId) {
                        clearTimeout(m.timerId);
                    }
                    p.splice(index, 1);
                }
            }

            this.sendWssClientBoardcast(wss, {
                event: 'CLIENT_QUIT_ROOM_BOARDCAST',
                payload: {
                    sender: userInfo.identity,
                    token: '',
                    userInfo: userInfo,
                    roomId: res.payload.roomId
                },
                timestamp: Date.now()
            })
        } catch (error) {
            Log.error(error);
            this.sendNormalError(ws);
        }
    }

    private clientPostRoom(ws: WebSocket, wss: ws.Server, res: z.infer<typeof PostRoomMessageSchema>) {
        try {
            const userInfo = res.payload.userInfo;
            const c = res.payload.createRoomInfo;

            const createRoomBody = JSON.stringify({
                name: c.name,
                rank: c.rank,
                options: c.options,
                password: c.password ?? null,
            })

            if (userInfo && userInfo.rank >= 3) {
                axios.post(`${this.httpServerUrl}/v1/api/rooms`, createRoomBody, {
                    headers: {
                        'Authorization': `Bearer ${res.payload.token}`,
                        'Content-Type': 'application/json'
                    }
                }).then((result) => {
                    if (result.status === 200) {
                        this.sendWsResponse(ws, wss, {
                            event: 'POST_ROOM',
                            timestamp: Date.now(),
                            payload: {
                                message: 'OK'
                            }
                        })

                        this.initRoomMapping();
                        this.getRooms(res.payload.token)
                            .then((result) => {
                                if (result.event === 'GET_ROOMS') {
                                    this.sendWssClientBoardcast(wss, {
                                        event: 'POST_ROOM_BOARDCAST',
                                        payload: {
                                            rooms: result.payload.rooms,
                                            livekit: result.payload.livekit,
                                            mapping: result.payload.mapping
                                        },
                                        timestamp: Date.now()
                                    })
                                } else {
                                    Log.error('Error result');
                                    this.sendWsResponse(ws, wss, {
                                        event: 'POST_ROOM_FAIL',
                                        payload: {
                                            error: 'Failed to create room'
                                        },
                                        timestamp: Date.now()
                                    })
                                }
                            }).catch((error) => {
                                Log.error(error);
                            })
                    } else {
                        this.sendWsResponse(ws, wss, {
                           event: 'POST_ROOM_FAIL',
                           payload: {
                               error: 'Failed to create room'
                           },
                           timestamp: Date.now()
                        })
                    }
                })
            } else {
                this.sendWsResponse(ws, wss, {
                    event: 'POST_ROOM_FAIL',
                    payload: {
                        error: 'Failed to create room || Not enough rank'
                    },
                    timestamp: Date.now()
                })
            }
        } catch (error) {
            Log.error(error);
            this.sendWsResponse(ws, wss, {
                event: 'POST_ROOM_FAIL',
                payload: {
                    error: 'Internal server error'
                },
                timestamp: Date.now()
            })
        }
    }

    private clientDeleteRoom(ws: WebSocket, wss: ws.Server, res: z.infer<typeof DeleteRoomMessageSchema>) {
        try {
            const d = res.payload.destroyRoomInfo;

            const userExists = this.serverRoomParticipants[d.roomId];

            if (userExists && userExists.length > 0) {
                this.sendWsResponse(ws, wss, {
                    event: 'DELETE_ROOM_FAIL',
                    payload: {
                        error: 'Failed to delete room || Room is not empty'
                    },
                    timestamp: Date.now()
                })
                return;
            }

            const roomId = d.roomId;
            axios.delete(`${this.httpServerUrl}/v1/api/rooms/${roomId}`, {
                headers: {
                    'Authorization': `Bearer ${res.payload.token}`,
                    'Content-Type': 'application/json'
                }
            }).then((result) => {
                if (result.status === 200) {
                    this.sendWsResponse(ws, wss, {
                        event: 'DELETE_ROOM',
                        payload: {
                            message: 'OK'
                        },
                        timestamp: Date.now()
                    })

                    this.initRoomMapping();
                    this.getRooms(res.payload.token)
                        .then((result) => {
                            if (result.event === 'GET_ROOMS') {
                                this.sendWssClientBoardcast(wss, {
                                    event: 'POST_ROOM_BOARDCAST',
                                    payload: {
                                        rooms: result.payload.rooms,
                                        livekit: result.payload.livekit,
                                        mapping: result.payload.mapping
                                    },
                                    timestamp: Date.now()
                                })
                            } else {
                                Log.error('Error result');
                                this.sendWsResponse(ws, wss, {
                                    event: 'DELETE_ROOM_FAIL',
                                    payload: {
                                        error: 'Failed to delete room'
                                    },
                                    timestamp: Date.now()
                                })
                            }
                        }).catch((error) => {
                            Log.error(error);
                        })
                } else {
                    Log.error('Failed to delete room');
                    this.sendWsResponse(ws, wss, {
                        event: 'DELETE_ROOM_FAIL',
                        payload: {
                            error: 'Failed to delete room'
                        },
                        timestamp: Date.now()
                    })
                }
            })
        } catch (error) {
            Log.error(error);
            this.sendWsResponse(ws, wss, {
                event: 'DELETE_ROOM_FAIL',
                payload: {
                    error: 'Internal server error'
                },
                timestamp: Date.now()
            })
        }
    }

    private handleMessage(ws: WebSocket, wss: ws.Server, message: string) {
        try {
            const res: typeof WsMessageSchema = JSON.parse(message);
            const data = WsMessageSchema.parse(res);

            if (data.payload.token) {
                switch (data.event) {
                    case 'GET_ROOMS':
                        this.getRooms(data.payload.token)
                            .then((rooms) => {
                                this.sendWsResponse(ws, wss, rooms);
                                Log.info('GET_ROOMS');
                            }).catch((error) => {
                                Log.error(error);
                            });
                        break;
                    case 'GET_PARTICIPANTS': 
                        this.getParticipants(data.payload.token)
                            .then((participants) => {
                                this.sendWsResponse(ws, wss, participants);
                                Log.info('GET_PARTICIPANTS');
                            }).catch((error) => {
                                Log.error(error);
                            });
                        break;
                    case 'PRE_JOIN_ROOM': 
                        this.handleJoinRoom(ws, wss, data)
                        break;
                    case 'JOIN_ROOM':
                        this.clientCurrentJoinRoom(ws, wss, data);
                        break;
                    case 'QUIT_ROOM': 
                        this.clientQuitRoom(ws, wss, data);
                        break;
                    case 'POST_ROOM':
                        this.clientPostRoom(ws, wss, data);
                        break;
                    case 'DELETE_ROOM':
                        this.clientDeleteRoom(ws, wss, data);
                        break;
                    default:
                        Log.error(`Invalid message event: ${data}`);
                        this.sendNormalError(ws);
                        return;
                }
            }
        } catch (error) {
            if (error instanceof z.ZodError) {
                Log.error('Zod validation error:', error.issues);
            } else {
                Log.error('Error parsing message:', error);
            }
            this.sendNormalError(ws);
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
            server.listen(config.wss_port, () => {
                Log.info(`The Logic server is being upgraded from the HTTP server`);
            });
        } else if (mode === 'https') {
            const httpsOptions = {
                key: fs.readFileSync(path.join(__dirname, '../cert/privkey.key')),
                cert: fs.readFileSync(path.join(__dirname, '../cert/domain.crt')),
            };
            server = https.createServer(httpsOptions, app);
            server.listen(config.wss_port, () => {
                Log.warn(`The Logic TLS server is being upgraded from the HTTPS server`);
            });
        }

        const wsOptions: ws.ServerOptions = {
            server: server,
        };

        const wss = new ws.Server(wsOptions);

        wss.on('listening', () => [
            Log.info(`The Logic server is listening on port ${config.wss_port}`),
        ])

        wss.on('connection', (ws: ws.WebSocket, req: IncomingMessage) => {
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

            const userConnection: UserConnection = {
                ws: ws,
                user: identity,
                ip: req.socket.remoteAddress || '0.0.0.0',
                connectedAt: new Date(),
                lastActivity: new Date(),
                heartbeatInterval: setInterval(() => {
                    if (Date.now() - userConnection.lastActivity.getTime() > 60_000) {
                        ws.close(1008, 'Inactive timeout');
                        this.onlineUsers.delete(identity);
                    } else {
                        ws.ping();
                    }
                }, 30_000)
            };

            this.onlineUsers.set(identity, userConnection);

            this.sendWelcomeMessage(ws);

            ws.on('message', (message: ws.RawData) => {
                userConnection.lastActivity = new Date();
                this.handleMessage(ws, wss, message.toString())
            });

            ws.on('pong', () => {
                userConnection.lastActivity = new Date();
            });

            ws.on('close', () => {
                if (userConnection.heartbeatInterval) {
                    clearInterval(userConnection.heartbeatInterval);
                }
                this.onlineUsers.delete(identity);
                for (const idIndex in this.serverRoomParticipants) {
                    if (this.serverRoomParticipants.hasOwnProperty(idIndex)) {
                        const p = this.serverRoomParticipants[idIndex];
                        const userIndex = p.findIndex(p => p.user.identity === identity);

                        if (userIndex !== -1) {
                            p.splice(userIndex, 1);
                            Log.info(`User ${identity} disconnected from room ${idIndex}`);

                            this.sendWssClientBoardcast(wss, {
                                event: 'CLIENT_QUIT_ROOM_BOARDCAST',
                                payload: {
                                    sender: identity,
                                    token: '',
                                    userInfo: {
                                        uid: -1,
                                        identity: identity,
                                        username: '',
                                        rank: -1
                                    },
                                    roomId: idIndex
                                },
                                timestamp: Date.now()
                            })
                            break;
                        }
                    }
                }
                
            });
        });

    }
}

// const a = new WebSocketServer();
// a.start();

export { router, WebSocketServer }