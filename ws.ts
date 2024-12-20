import ws, { WebSocket } from 'ws';
import express from 'express';
import fs from 'fs';
import https from 'https';
import config from './app_options';
import Clg from './utils/clg';
import axios from 'axios';
import { roomJoinTokenResponseType, roomsResponseType } from './types/server';
import { CreateOptions, Room } from 'livekit-server-sdk';
import { UserInfoType, UserSymplyType } from './types/user';
import { IncomingMessage } from 'http';
import parseURLParameters from './utils/parseURLParameters';
import { decodeTokenUser } from './middleware/verifytoken';
import deepcopy from './utils/deepCopy';

export interface wsMessageType {
    code: string;
    data: any;
    token?: string;
    from_identity?: string;
    from_server?: string;
    to_identity?: string;
}

interface RoomInfo {
    id: number;
    name: string;
    rank: number;
    is_delete: number;
    created_at: string;
    updated_at: string;
    room_options: string;
}

interface RoomCreateInfo {
    name: string;
    rank: number;
    room_options: CreateOptions;
}

interface RoomDestroyInfo {
    room_id: number;
    name: string;
}

interface RoomMapping {
    [roomId: string]: string | undefined; // roomId -> livekitRoomName
}

interface RoomMemberStatus {
    user: UserSymplyType;
    status: 0 | 1 | 2; // 0: 准备加入, 1: 正在加入, 2: 加入成功
    updateTime: number;
    timerId?: NodeJS.Timeout;
}

interface RoomParticipants {
    [roomId: string]: RoomMemberStatus[];
}

interface UserConnection {
    ws: WebSocket;
    user: UserInfoType["identity"];
}

class WebSocketApp {
    private serverUserConnections: Map<string, UserConnection> = new Map();
    private serverRoomInfo: RoomInfo[] = [];
    private serverRoomMapping: RoomMapping = {};
    private serverRoomParticipants: RoomParticipants = {};
    private httpServerUrl: string;

    constructor(httpServerUrl: string) {
        this.httpServerUrl = httpServerUrl;
    }

    public start() {
        const app = express();
        const mode = config.run_mode;

        if (mode !== 'http' && mode !== 'https') {
            Clg.error(`Invalid run mode: ${mode}. Expected "http" or "https".`, 'createWebSocketServer');
            process.exit(1);
        }

        let server;

        if (mode === 'http') {
            server = require('http').createServer(app);
            server.listen(config.wss_port, () => {
                Clg.info(`The WS server is being upgraded from the HTTP server`, `ServerStart:WS`);
            });
        } else if (mode === 'https') {
            const httpsOptions = {
                key: fs.readFileSync('./cert/privkey.key'),
                cert: fs.readFileSync('./cert/domain.crt'),
            };
            server = https.createServer(httpsOptions, app);
            server.listen(config.wss_port, () => {
                Clg.warn(`The WSS server is being upgraded from the HTTPS server`, `ServerStart:WSS`);
            });
        }

        const wsOptions: ws.ServerOptions = {
            server: server,
        };

        const wss = new ws.Server(wsOptions);

        wss.on('listening', () => {
            Clg.info('WebSocket server listening on port ' + config.wss_port, 'createWebSocketServer');
            this.initializeRoomMapping();
        });

        wss.on('connection', (ws: ws, req: IncomingMessage) => {
            if (req.url) {
                const params = parseURLParameters(req.url);

                if (params !== null) {
                    const { identity, token } = params;

                    const decodeToken = decodeTokenUser(token);
                    if (decodeToken && identity === decodeToken.identity) {
                        Clg.info('New WebSocket connection', 'createWebSocketServer');

                        const user: UserInfoType["identity"] = identity;
                        const userConnection: UserConnection = { ws, user };
                        this.serverUserConnections.set(identity, userConnection);

                        wss.clients.forEach((client) => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'clientConected',
                                    data: '',
                                    from_identity: identity
                                }));
                            } else {
                                Clg.error('Client Error', 'createWebSocketServer');
                                ws.send(JSON.stringify({
                                    code: 'messageError',
                                    data: 'Invalid request'
                                }));
                                ws.close();
                            }
                        });

                        ws.on('message', (message: Buffer) => {
                            this.handleMessage(ws, wss, message);
                        });

                        ws.on('close', () => {
                            this.handleClose(ws, wss, user);
                        })
                    } else {
                        Clg.error('Invalid token or identity', 'createWebSocketServer');
                        ws.send(JSON.stringify({
                            code: 'messageError',
                            data: 'Invalid token or identity'
                        }));
                        ws.close();
                    }
                } else {
                    Clg.error('Invalid request: params', 'createWebSocketServer');
                    ws.send(JSON.stringify({
                        code: 'messageError',
                        data: 'Invalid request'
                    }));
                    ws.close();
                }
            } else {
                Clg.error('Invalid request: req.url', 'createWebSocketServer');
                ws.send(JSON.stringify({
                    code: 'messageError',
                    data: 'Invalid request'
                }));
                ws.close();
            }
        });
    }

    private async handleMessage(ws: ws, wss: ws.Server, message: Buffer) {
        try {
            const res: wsMessageType = JSON.parse(message.toString());

            if (res.token) {
                switch (res.code) {
                    case 'getRooms':
                        const roomsResult = await this.clientGetRooms(res.token);
                        ws.send(JSON.stringify(roomsResult));
                        Clg.info('Client get rooms', 'createWebSocketServer');
                        break;
                    case 'getParticipants':
                        const participantsResult = await this.clientGetParticipants(res.token);
                        ws.send(JSON.stringify(participantsResult));
                        Clg.info('Client get participants', 'createWebSocketServer');
                        break;
                    case 'clientJoin':
                        await this.handleClientJoin(ws, res);
                        break;
                    case 'clientCurrentJoin':
                        await this.handleClientCurrentJoin(res);
                        break;
                    // 用户主动退出的情况，后面细分
                    case 'clientQuit':
                        await this.handleClientQuit(ws, wss, res);
                        break;
                    case 'clientNewRoom': 
                        await this.handleClientNewRoom(ws, wss, res);
                        break;
                    case 'clientDestroyRoom':
                        await this.handleClientDestroyRoom(ws, wss, res);
                        break;
                    default:
                        Clg.error('Unknown message code', 'createWebSocketServer');
                        ws.send(JSON.stringify({
                            code: 'messageError',
                            data: 'Unknown message code'
                        }));
                }
            } else {
                Clg.error('Missing token', 'createWebSocketServer');
                ws.send(JSON.stringify({
                    code: 'messageError',
                    data: 'Missing token'
                }));
            }
        } catch (error: any) {
            Clg.error(error, 'handleMessage');
            ws.send(JSON.stringify({
                code: 'messageError',
                data: 'Internal server error'
            }));
        }
    }

    private handleClose(ws: ws, wss: ws.Server, user: UserInfoType["identity"]) {
        Clg.info(`WebSocket connection closed for user: ${user}`, 'createWebSocketServer');
        this.serverUserConnections.delete(user);

        for (const roomId in this.serverRoomParticipants) {
            const participants = this.serverRoomParticipants[roomId];
            const index = participants.findIndex(participant => participant.user.identity === user);
            if (index !== -1) {
                const memberStatus = participants[index];
                if (memberStatus.timerId) {
                    clearTimeout(memberStatus.timerId);
                }
                participants.splice(index, 1);
            }
        }

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'clientDisconnected',
                    data: '',
                    from_identity: user
                }));
            }
        });
    }

    private async clientGetRooms(userToken: string): Promise<wsMessageType> {
        try {
            const roomsResponse = await axios.get<roomsResponseType[]>(`${this.httpServerUrl}/server/rooms`, {
                headers: {
                    Authorization: `Bearer ${userToken}`
                }
            });
            const rooms = roomsResponse.data;

            const livekitRoomsResponse = await axios.get<Room[]>(`${this.httpServerUrl}/server/rooms_livekit`, {
                headers: {
                    Authorization: `Bearer ${userToken}`
                }
            });
            const livekitRooms = livekitRoomsResponse.data;

            if (rooms && livekitRooms) {
                let roomMapping: RoomMapping = {};

                rooms.forEach(room => {
                    const livekitRoom = livekitRooms.find(lkRoom => lkRoom.name === String(room.id));
                    roomMapping[room.id] = livekitRoom ? livekitRoom.name : undefined;
                });

                return {
                    code: 'getRoomsResponseSuccess',
                    data: {
                        rooms,
                        livekitRooms,
                        roomMapping
                    },
                    from_server: 'serverV1'
                };
            } else {
                Clg.error('One of the responses is empty', 'clientGetRooms');
                return {
                    code: 'getRoomsResponseError',
                    data: {
                        error: 'Internal server error'
                    }
                };
            }
        } catch (err: any) {
            Clg.error(err, 'clientGetRooms');
            return {
                code: 'getRoomsResponseError',
                data: {
                    error: 'Internal server error'
                }
            };
        }
    }

    private async clientGetParticipants(userToken: string): Promise<wsMessageType> {
        try {
            const participantsCopy = deepcopy(this.serverRoomParticipants);

            function removeTimerIds(participants: RoomParticipants) {
                for (const key in participants) {
                    if (Array.isArray(participants[key])) {
                        participants[key] = participants[key].map(item => {
                            const { timerId, ...rest } = item;
                            return rest;
                        });
                    }
                }
            }

            removeTimerIds(participantsCopy);

            return {
                code: 'getParticipantsResponseSuccess',
                data: { participants: participantsCopy },
                from_server: 'serverV1',
            };
        } catch (error: any) {
            Clg.error(error, 'clientGetParticipants');
            return {
                code: 'getParticipantsResponseError',
                data: 'Internal server error'
            };
        }
    }

    private async handleClientJoin(ws: ws, res: wsMessageType) {
        const roomId: string = res.data.room_id;
        const userInfo: any = res.data.user_info;

        if (this.isUserSymplyType(userInfo) && roomId && res.token) {
            if (!this.serverRoomParticipants[roomId]) {
                this.serverRoomParticipants[roomId] = [];
            }

            const memberStatus: RoomMemberStatus = { user: userInfo, status: 0, updateTime: Date.now() };
            this.serverRoomParticipants[roomId].push(memberStatus);

            const timeoutDuration = 60000; // 60秒
            memberStatus.timerId = setTimeout(() => {
                const memberIndex = this.serverRoomParticipants[roomId].findIndex(member => member.user.uid === userInfo.uid);
                if (memberIndex !== -1 && this.serverRoomParticipants[roomId][memberIndex].status < 2) {
                    this.serverRoomParticipants[roomId].splice(memberIndex, 1);
                    Clg.info(`User ${userInfo.username} removed due to timeout in room ${roomId}`, 'createWebSocketServer');
                }
            }, timeoutDuration);

            try {
                const result = await axios.get<roomJoinTokenResponseType>(
                    `${this.httpServerUrl}/server/room_join_token?room_id=${roomId}&identity=${userInfo.identity}`,
                    {
                        headers: {
                            Authorization: `Bearer ${res.token}`
                        }
                    }
                );

                if (result.status === 200) {
                    const lkToken = result.data.token;
                    const verifyData = result.data.verifyData;

                    const memberIndex = this.serverRoomParticipants[roomId].findIndex(member => member.user.uid === userInfo.uid);
                    if (memberIndex !== -1) {
                        this.serverRoomParticipants[roomId][memberIndex].status = 1;
                        this.serverRoomParticipants[roomId][memberIndex].updateTime = Date.now();
                    }

                    const isRoomCreatedInLiveKit = (roomId: string): boolean => {
                        return this.serverRoomMapping[roomId] !== undefined;
                    };

                    if (!isRoomCreatedInLiveKit(roomId) && this.serverRoomInfo[Number(roomId) - 1].room_options) {
                        const createLiveKitRoomRequest = JSON.stringify({
                            room_id: roomId,
                            max_participants: JSON.parse(this.serverRoomInfo[Number(roomId) - 1].room_options).max_participants,
                            verifyData: verifyData
                        });

                        const createRoomResult = await axios.post(
                            `${this.httpServerUrl}/server/room_create_livekit`,
                            createLiveKitRoomRequest,
                            {
                                headers: {
                                    'Authorization': `Bearer ${res.token}`,
                                    'Content-Type': 'application/json'
                                }
                            }
                        );

                        if (createRoomResult.status === 200) {
                            ws.send(JSON.stringify({
                                code: 'clientJoinResponseSuccess',
                                data: {
                                    type: 'Create and Join',
                                    lkToken: lkToken,
                                    lkRoom: roomId,
                                    livekitUrl: config.livekitHost
                                },
                                from_server: 'serverV1'
                            }));

                            this.initializeRoomMapping();
                        } else {
                            Clg.error(`Failed to create LiveKit room: ${createRoomResult.status}`, 'createWebSocketServer');
                            ws.send(JSON.stringify({
                                code: 'clientJoinResponseFailed',
                                error: 'Failed to create LiveKit room'
                            }));
                        }
                    } else {
                        ws.send(JSON.stringify({
                            code: 'clientJoinResponseSuccess',
                            data: {
                                type: 'Only Join',
                                lkToken: lkToken,
                                lkRoom: roomId,
                                livekitUrl: config.livekitHost
                            },
                            from_server: 'serverV1'
                        }));
                    }
                } else {
                    Clg.error('Failed to get LiveKit token', 'get_livekit_token');
                    ws.send(JSON.stringify({
                        code: 'messageError',
                        error: 'Failed to get LiveKit token'
                    }));
                }
            } catch (error: any) {
                Clg.error(error, 'get_livekit_token');
                ws.send(JSON.stringify({
                    code: 'messageError',
                    error: 'Error getting LiveKit token'
                }));
            }
        } else {
            Clg.error('Invalid user info or room ID', 'createWebSocketServer');
            ws.send(JSON.stringify({
                code: 'messageError',
                data: 'Invalid user info or room ID'
            }));
        }
    }

    private async handleClientQuit(ws: ws, wss: ws.Server,  res: wsMessageType) {
        const userInfo: UserSymplyType = res.data.user_info;

        this.serverUserConnections.delete(userInfo.identity);

        for (const roomId in this.serverRoomParticipants) {
            const participants = this.serverRoomParticipants[roomId];
            const index = participants.findIndex(participant => participant.user.identity === userInfo.identity);
            if (index !== -1) {
                const memberStatus = participants[index];
                if (memberStatus.timerId) {
                    clearTimeout(memberStatus.timerId);
                }
                participants.splice(index, 1);
            }
        }

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'clientDisconnected',
                    data: '',
                    from_identity: userInfo.identity
                }));
            }
        });
    }

    private async handleClientNewRoom(ws: ws, wss: ws.Server, res: wsMessageType) {
        const userInfo: UserSymplyType = res.data.user_info;
        const createRoomInfo: RoomCreateInfo = res.data.create_room_info;

        const createRoomBody = JSON.stringify({
            name: createRoomInfo.name,
            rank: createRoomInfo.rank,
            room_options: {
                max_participants: createRoomInfo.room_options.maxParticipants
            }
        })

        if (userInfo && userInfo.rank >= 3) {
            try {
                // console.log(createRoomBody)
                axios.post(`${this.httpServerUrl}/server/room_create`, createRoomBody, {
                    headers: {
                        'Authorization': `Bearer ${res.token}`,
                        'Content-Type': 'application/json'
                    }
                }).then(async (response) => {
                    if (response.status === 200) {
                        this.initializeRoomMapping();
                        ws.send(JSON.stringify({
                            code: 'clientNewRoomResponseSuccess',
                            data: response.data.message
                        }));
                    }
                }).catch((error) => {
                    Clg.error(error, 'createWebSocketServer');
                    ws.send(JSON.stringify({
                        code: 'clientNewRoomResponseFailed',
                        data: 'Error creating new room'
                    }));
                });
            } catch (error: any) {
                Clg.error(error, 'createWebSocketServer');
                ws.send(JSON.stringify({
                    code: 'clientNewRoomResponseFailed',
                    data: 'Error creating new room'
                }));
            }
        } else {
            ws.send(JSON.stringify({
                code: 'clientNewRoomResponseFailed',
                data: 'Only admins can create new rooms'
            }));
        }
    }

    private async handleClientDestroyRoom(ws: ws, wss: ws.Server, res: wsMessageType) {
        const destroyRoomInfo: RoomDestroyInfo = res.data.destroy_room_info;
    
        try {
            const usersInRoom = this.serverRoomParticipants[`${destroyRoomInfo.room_id}`];
    
            if (usersInRoom && usersInRoom.length > 1) {
                ws.send(JSON.stringify({
                    code: 'clientDestroyRoomResponseFailed',
                    data: 'Cannot delete room with active users'
                }));
                return;
            }
    
            const destroyRoomBody = JSON.stringify({
                room_id: destroyRoomInfo.room_id
            });
    
            const response = await axios.delete(`${this.httpServerUrl}/server/room_delete`, {
                headers: {
                    'Authorization': `Bearer ${res.token}`,
                    'Content-Type': 'application/json'
                },
                data: destroyRoomBody
            });
    
            if (response.status === 200) {
                this.initializeRoomMapping();
                ws.send(JSON.stringify({
                    code: 'clientDestroyRoomResponseSuccess',
                    data: response.data.message
                }));
            } else {
                Clg.error(response.data.message, 'createWebSocketServer');
                ws.send(JSON.stringify({
                    code: 'clientDestroyRoomResponseFailed',
                    data: 'Error destroying room'
                }));
            }
        } catch (error: any) {
            Clg.error(error, 'createWebSocketServer');
            ws.send(JSON.stringify({
                code: 'clientDestroyRoomResponseFailed',
                data: 'Error destroying room'
            }));
        }
    }

    private async handleClientCurrentJoin(res: wsMessageType) {
        const roomId: string = res.data.room_id;
        const userInfo: any = res.data.user_info;

        if (this.serverRoomParticipants[roomId]) {
            const memberIndex = this.serverRoomParticipants[roomId].findIndex(member => member.user.uid === userInfo.uid);
            if (memberIndex !== -1) {
                const memberStatus = this.serverRoomParticipants[roomId][memberIndex];
                if (memberStatus.timerId) {
                    clearTimeout(memberStatus.timerId);

                    // 更新状态为加入成功
                    memberStatus.status = 2;
                    memberStatus.updateTime = Date.now();
                } else {
                    Clg.error(`Timer for user ${memberStatus.user.username} in room ${roomId} not found`, 'createWebSocketServer');
                }
            } else {
                Clg.error(`User ${userInfo.uid} not found in room ${roomId}`, 'createWebSocketServer');
            }
        } else {
            Clg.error(`Room ${roomId} not found`, 'createWebSocketServer');
        }
    }

    private isUserSymplyType(user: any): user is UserSymplyType {
        return (
            typeof user === 'object' &&
            user !== null &&
            typeof user.uid === 'number' &&
            typeof user.rank === 'number' &&
            typeof user.identity === 'string' &&
            typeof user.username === 'string'
        );
    }

    private initializeRoomMapping(retryCount: number = 3, delay: number = 2000) {
        this.clientGetRooms(config.serverAdminToken)
            .then((result) => {
                if (result.code === 'getRoomsResponseSuccess') {
                    this.serverRoomMapping = result.data.roomMapping;
                    this.serverRoomInfo = result.data.rooms;
                    Clg.info('Room mapping initialized', 'createWebSocketServer');
                } else {
                    Clg.error('Failed to initialize room mapping', 'createWebSocketServer');
                    if (retryCount > 0) {
                        setTimeout(() => this.initializeRoomMapping(retryCount - 1, delay), delay);
                    } else {
                        Clg.error('Failed to initialize room mapping after retries', 'createWebSocketServer');
                        process.exit(1);
                    }
                }
            })
            .catch((error) => {
                Clg.error(error, 'createWebSocketServer');
                if (retryCount > 0) {
                    setTimeout(() => this.initializeRoomMapping(retryCount - 1, delay), delay);
                }
            });
    }
}

export default WebSocketApp;