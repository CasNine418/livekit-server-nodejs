/**
 * websocket app.ts
 */

import ws, { WebSocket } from 'ws';
import express from 'express';
import fs from 'fs';
import https from 'https';
import config from './app_options';
import Clg from './utils/clg';
import axios from 'axios';
import { roomJoinTokenResponseType, roomsResponseType } from './types/server';
import { Room } from 'livekit-server-sdk';
import { UserInfoType, UserSymplyType } from './types/user';
import { IncomingMessage } from 'http';
import parseURLParameters from './utils/parseURLParameters';
import { decodeTokenUser } from './middleware/verifytoken';
import deepcopy from './utils/deepCopy';

export interface wsMessageType {
    code: string,
    data: any,
    token?: string,
    from_identity?: string,
    from_server?: string,
    to_identity?: string,
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

let serverUserConnections: Map<string, UserConnection> = new Map();
let serverRoomInfo: RoomInfo[] = [];
let serverRoomMapping: RoomMapping = {};
let serverRoomParticipants: RoomParticipants = {};

const httpServerUrl = config.httpServerUrl;

const clientGetRooms = async (userToken: string): Promise<wsMessageType> => {
    try {
        const roomsResponse = await axios.get<roomsResponseType[]>(`${httpServerUrl}/server/rooms`, {
            headers: {
                Authorization: `Bearer ${userToken}`
            }
        });
        const rooms = roomsResponse.data;

        const livekitRoomsResponse = await axios.get<Room[]>(`${httpServerUrl}/server/rooms_livekit`, {
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

const clientGetParticipants = async (userToken: string): Promise<wsMessageType> => {
    try {
        const participantsCopy = deepcopy(serverRoomParticipants);

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
};

const initializeRoomMapping = (retryCount: number = 3, delay: number = 2000) => {
    clientGetRooms(config.serverAdminToken) // Use an admin token or a valid token
        .then((result) => {
            if (result.code === 'getRoomsResponseSuccess') {
                serverRoomMapping = result.data.roomMapping;
                serverRoomInfo = result.data.rooms;
                Clg.info('Room mapping initialized', 'createWebSocketServer');
            } else {
                Clg.error('Failed to initialize room mapping', 'createWebSocketServer');
                if (retryCount > 0) {
                    setTimeout(() => initializeRoomMapping(retryCount - 1, delay), delay);
                } else {
                    Clg.error('Failed to initialize room mapping after retries', 'createWebSocketServer');
                    process.exit(1);
                }
            }
        })
        .catch((error) => {
            Clg.error(error, 'createWebSocketServer');
            if (retryCount > 0) {
                setTimeout(() => initializeRoomMapping(retryCount - 1, delay), delay);
            }
        });
};



// ======================================================================================================



// 开启WebSocket服务器
const createWebSocketServer = () => {
    const app = express();
    const mode = config.run_mode;

    if (mode !== 'http' && mode !== 'https') {
        Clg.error(`Invalid run mode: ${mode}. Expected "http" or "https".`, 'createWebSocketServer');
        process.exit(1);
    }

    let server;

    if (mode === 'http') {
        // 启动普通的 WebSocket 服务器
        server = require('http').createServer(app);
        server.listen(config.wss_port, () => {
            Clg.info(`The WS server is being upgraded from the HTTP server`, `ServerStart:WS`);
        });
    } else if (mode === 'https') {
        // 启动安全的 WebSocket 服务器
        const httpsOptions = {
            key: fs.readFileSync('./cert/privkey.key'),
            cert: fs.readFileSync('./cert/domain.crt'),
            // ca: [fs.readFileSync('./cert/root_bundle.crt')]
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



    // 正式地开启WebSocket服务器 ==========================================================================




    wss.on('listening', () => {
        Clg.info('WebSocket server listening on port ' + config.wss_port, 'createWebSocketServer');

        initializeRoomMapping();

        // const initRoomParticipantsRoomIds = Object.keys(serverRoomParticipants);

        // initRoomParticipantsRoomIds.forEach(roomId => {
        //     serverRoomParticipants[roomId] = [];
        // });
    })

    wss.on('connection', (ws: ws, req: IncomingMessage) => {
        if (req.url) {
            const params = parseURLParameters(req.url);

            if (params !== null) {
                const { identity, token } = params;

                const decodeToken = decodeTokenUser(token);
                if (decodeToken) {
                    if (identity === decodeToken.identity) {
                        Clg.info('New WebSocket connection', 'createWebSocketServer');

                        const user: UserInfoType["identity"] = identity;
                        const userConnection: UserConnection = { ws, user };
                        serverUserConnections.set(identity, userConnection);

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
                        })


                        


                        // =================================================================================================






                        ws.on('message', (message: Buffer) => {
                            Promise.resolve()
                                .then(async () => {
                                    const res: wsMessageType = JSON.parse(message.toString());
                                    if (res.token) {

                                        /**
                                         * 获取房间列表
                                         */
                                        if (res.code === 'getRooms') {
                                            clientGetRooms(res.token)
                                                .then((result) => {
                                                    ws.send(JSON.stringify(result));
                                                    Clg.info('Client get rooms', 'createWebSocketServer');

                                                })
                                                .catch((error) => {
                                                    Clg.error(error, 'createWebSocketServer');
                                                    ws.send(JSON.stringify({
                                                        code: 'messageError',
                                                        data: 'Internal server error'
                                                    }));
                                                });
                                        }

                                        /**
                                         * 获取房间内用户列表
                                         */
                                        if (res.code === 'getParticipants') {
                                            clientGetParticipants(res.token)
                                                .then((result => {
                                                    Clg.info('Client get participants', 'createWebSocketServer');
                                                    ws.send(JSON.stringify(result))
                                                }))
                                                .catch((error) => {
                                                    Clg.error(error, 'createWebSocketServer');
                                                    ws.send(JSON.stringify({
                                                        code: 'messageError',
                                                        data: 'Internal server error'
                                                    }));
                                                });
                                        }

                                        /**
                                         * 客户端请求加入房间
                                         */
                                        if (res.code === 'clientJoin') {
                                            const roomId: string = res.data.room_id;
                                            const userInfo: any = res.data.user_info;

                                            /**
                                             * 类型保护函数
                                             * 
                                             * @param user 任意类型的用户对象，待检查的对象
                                             * @returns 如果用户对象符合简化类型用户的定义，则返回true；否则返回false
                                             */
                                            function isUserSymplyType(user: any): user is UserSymplyType {
                                                return (
                                                    typeof user === 'object' &&
                                                    user !== null &&
                                                    typeof user.uid === 'number' &&
                                                    typeof user.rank === 'number' &&
                                                    typeof user.identity === 'string' &&
                                                    typeof user.username === 'string'
                                                );
                                            }

                                            if (isUserSymplyType(userInfo) && roomId && res.token) {

                                                if (!serverRoomParticipants[roomId]) {
                                                    serverRoomParticipants[roomId] = [];
                                                }

                                                const memberStatus: RoomMemberStatus = { user: userInfo, status: 0, updateTime: Date.now() };
                                                serverRoomParticipants[roomId].push(memberStatus);

                                                // 设置定时器
                                                const timeoutDuration = 60000; // 60秒
                                                memberStatus.timerId = setTimeout(() => {
                                                    const memberIndex = serverRoomParticipants[roomId].findIndex(member => member.user.uid === userInfo.uid);
                                                    if (memberIndex !== -1 && serverRoomParticipants[roomId][memberIndex].status < 2) {
                                                        serverRoomParticipants[roomId].splice(memberIndex, 1);
                                                        Clg.info(`User ${userInfo.username} removed due to timeout in room ${roomId}`, 'createWebSocketServer');
                                                    }
                                                }, timeoutDuration);

                                                axios.get<roomJoinTokenResponseType>(
                                                    `${httpServerUrl}/server/room_join_token?room_id=${roomId}&identity=${userInfo.identity}`,
                                                    {
                                                        headers: {
                                                            Authorization: `Bearer ${res.token}`
                                                        }
                                                    }
                                                )
                                                    .then((result) => {
                                                        if (result.status === 200) {
                                                            const lkToken = result.data.token;
                                                            const verifyData = result.data.verifyData;

                                                            const memberIndex = serverRoomParticipants[roomId].findIndex(member => member.user.uid === userInfo.uid);
                                                            if (memberIndex !== -1) {
                                                                serverRoomParticipants[roomId][memberIndex].status = 1;
                                                                serverRoomParticipants[roomId][memberIndex].updateTime = Date.now();
                                                            }

                                                            const isRoomCreatedInLiveKit = (roomId: string): boolean => {
                                                                return serverRoomMapping[roomId] !== undefined;
                                                            };

                                                            if (isRoomCreatedInLiveKit(roomId) === false && serverRoomInfo[Number(roomId) - 1].room_options) {

                                                                // 房间需要创建
                                                                const createLiveKitRoomRequest = JSON.stringify({
                                                                    room_id: roomId,
                                                                    max_participants: JSON.parse(serverRoomInfo[Number(roomId) - 1].room_options).max_participants,
                                                                    verifyData: verifyData
                                                                })

                                                                axios.post(
                                                                    `${httpServerUrl}/server/room_create_livekit`,
                                                                    createLiveKitRoomRequest,
                                                                    {
                                                                        headers: {
                                                                            'Authorization': `Bearer ${res.token}`,
                                                                            'Content-Type': 'application/json'
                                                                        }
                                                                    }
                                                                )
                                                                    .then((result) => {
                                                                        if (result.status === 200) {
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
                                                                        } else {
                                                                            Clg.error(`Failed to create LiveKit room: ${result.status}`, 'createWebSocketServer');
                                                                            ws.send(JSON.stringify({
                                                                                code: 'clientJoinResponseFailed',
                                                                                error: 'Failed to create LiveKit room'
                                                                            }));
                                                                        }
                                                                    })
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
                                                    })
                                                    .catch(error => {
                                                        Clg.error(error, 'get_livekit_token');
                                                        ws.send(JSON.stringify({
                                                            code: 'messageError',
                                                            error: 'Error getting LiveKit token'
                                                        }));
                                                    });
                                            } else {
                                                Clg.error('Invalid user info or room ID', 'createWebSocketServer');
                                                ws.send(JSON.stringify({
                                                    code: 'messageError',
                                                    data: 'Invalid user info or room ID'
                                                }));
                                            }
                                        }

                                        /**
                                         * 验证通过，取消定时器
                                         */
                                        if (res.code === 'clientCurrentJoin') {
                                            const roomId: string = res.data.room_id;
                                            const userInfo: any = res.data.user_info;

                                            if (serverRoomParticipants[roomId]) {
                                                const memberIndex = serverRoomParticipants[roomId].findIndex(member => member.user.uid === userInfo.uid);
                                                if (memberIndex !== -1) {
                                                    const memberStatus = serverRoomParticipants[roomId][memberIndex];
                                                    if (memberStatus.timerId) {
                                                        clearTimeout(memberStatus.timerId);

                                                        // 更新状态为加入成功
                                                        memberStatus.status = 2;
                                                        memberStatus.updateTime = Date.now();
                                                        memberStatus.timerId = undefined;

                                                        initializeRoomMapping();

                                                        Clg.info(`Timer for user ${memberStatus.user.username} in room ${roomId} cleared`, 'createWebSocketServer');
                                                        ws.send(JSON.stringify({
                                                            code: 'clientCurrentJoinResponseSuccess',
                                                            data: 'Success'
                                                        }));
                                                    } else {
                                                        Clg.error('User already join or not exist', 'createWebSocketServer');
                                                        ws.send(JSON.stringify({
                                                            code: 'messageError',
                                                            data: 'User already join or not exist'
                                                        }));
                                                    }
                                                } else {
                                                    Clg.warn(`Invaild User`, 'createWebSocketServer');
                                                    ws.send(JSON.stringify({
                                                        code: 'messageError',
                                                        data: 'Invaild User'
                                                    }));
                                                }
                                            } else {
                                                Clg.error('Err: Update member status failed', 'createWebSocketServer');
                                                ws.send(JSON.stringify({
                                                    code: 'messageError',
                                                    data: 'Internal server error'
                                                }));
                                            }
                                        }

                                    }
                                })
                                .catch((error) => {
                                    Clg.error(error, 'createWebSocketServer');
                                    ws.send(JSON.stringify({
                                        code: 'messageError',
                                        data: 'Internal server error'
                                    }));
                                });
                        });

                        ws.on('close', () => {
                            Clg.info('WebSocket connection closed', 'createWebSocketServer');

                            // 删除连接用户表中的用户
                            serverUserConnections.delete(identity);
                            
                            // 删除房间成员表中的用户
                            for (const roomId in serverRoomParticipants) {
                                const roomParticipants = serverRoomParticipants[roomId];
                                const index = roomParticipants.findIndex(member => member.user.identity === identity);
                                if (index !== -1) {
                                    roomParticipants.splice(index, 1);
                                    Clg.info(`User ${identity} removed from room${roomId}`, 'createWebSocketServer');
                                }
                            }

                            Clg.info(`User ${identity} disconnected`, 'createWebSocketServer');

                            wss.clients.forEach((client) => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({
                                        type: 'clientClose',
                                        data: 'closed'
                                    }));
                                }
                            })
                        });



                    } else {
                        Clg.error('Invalid request: token verify', 'createWebSocketServer');
                        ws.send(JSON.stringify({
                            code: 'messageError',
                            data: 'Invalid request'
                        }));
                        ws.close();
                    }
                } else {
                    Clg.error('Invalid request: decodeToken', 'createWebSocketServer');
                    ws.send(JSON.stringify({
                        code: 'messageError',
                        data: 'Invalid request'
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
    })
}

export default createWebSocketServer;