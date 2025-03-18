import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { z } from "zod";
import {
    LivekitRoomSchema,
    ApiRoomsResponseType,
    RoomMappingSchema,
    WsResponseSchema
} from "./schemas";
import axios from "axios";
import { Logger } from 'tslog';

const Log = new Logger({ name: 'RoomManager' });

class RoomManager {
    private roomInfo = new Map<string, z.infer<typeof ApiRoomsResponseType>>();
    private roomMapping = new Map<string, string>();
    private participants = new Map<string, Map<string, any>>(); // roomId -> Map<userId, status>
    private httpServerUrl: string;
    private adminToken: string;

    constructor(config: { httpServerUrl: string; adminToken: string }) {
        this.httpServerUrl = config.httpServerUrl;
        this.adminToken = config.adminToken;
        this.initAutoRefresh(30_000);
    }

    // 主入口
    public async handleMessage(msg: RoomManagerMessage) {
        switch (msg.type) {
            case 'GET_ROOMS':
                return this.getRooms();
            // case 'UPDATE_PARTICIPANT':
            //     return this.updateParticipant(msg.payload);
            // case 'DELETE_ROOM':
            //     return this.deleteRoom(msg.payload.roomId);
            // 添加其他消息类型...
        }
    }

    private async getRooms() {
        try {
            const [roomsRes, livekitRes] = await Promise.all([
                axios.get(`${this.httpServerUrl}/v1/api/rooms`, {
                    headers: { Authorization: `Bearer ${this.adminToken}` }
                }),
                axios.get(`${this.httpServerUrl}/v1/api/livekit/rooms`, {
                    headers: { Authorization: `Bearer ${this.adminToken}` }
                })
            ]);

            // 数据校验和转换逻辑...
            return WsResponseSchema.parse({
                event: 'GET_ROOMS',
                payload: { /* 格式化后的数据 */ }
            });
        } catch (error) {
            // return this.handleError(error);
        }
    }

    private initAutoRefresh(interval: number) {
        setInterval(async () => {
            await this.getRooms();
            Log.debug("Auto refreshed room data");
        }, interval);
    }

    // 其他房间管理方法...
}

// Worker线程入口
if (!isMainThread) {
    const manager = new RoomManager(workerData.config);
    parentPort?.on('message', async (msg) => {
        const result = await manager.handleMessage(msg);
        parentPort?.postMessage(result);
    });
}

export type RoomManagerMessage = {
    type: 'GET_ROOMS' | 'UPDATE_PARTICIPANT' | 'DELETE_ROOM';
    payload?: any;
};

export function createRoomManager(config: any): Promise<Worker> {
    return new Promise((resolve) => {
        const worker = new Worker(__filename, {
            workerData: { config }
        });
        worker.on('online', () => resolve(worker));
        worker.on('message', (msg) => {

        })
        worker.on('messageerror', (error) => {

        })
    });
}