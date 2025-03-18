import { z } from "zod";
// import 'node';

export const RoomEgressSchema = z.object({
    type: z.string(),
    destination: z.string(),
    codec: z.string().optional(),
});

export const CreateOptionsSchema = z.object({
    name: z.string().default("default_room"),
    emptyTimeout: z.number().optional(),
    departureTimeout: z.number().optional(),
    maxParticipants: z.number().optional(),
    metadata: z.string().optional(),
    egress: RoomEgressSchema.optional(),
    minPlayoutDelay: z.number().optional(),
    maxPlayoutDelay: z.number().optional(),
    syncStreams: z.boolean().optional(),
    nodeId: z.string().optional(),
});

export const RoomCreateInfo = z.object({
    name: z.string(),
    rank: z.number(),
    options: CreateOptionsSchema,
    password: z.string().optional(),
})

export const DestroyRoomInfo = z.object({
    roomId: z.string(),
    name: z.string(),
});

// ---

export const ApiRoomsResponseType = z.object({
    id: z.string(),
    uuid: z.string().uuid(),
    name: z.string(),
    rank: z.number(),
    is_delete: z.number(),
    create_at: z.string(),
    updated_at: z.string(),
    options: CreateOptionsSchema.optional()
})

export const ApiGetRoomTokenResponseType = z.object({
    message: z.string(),
    data: z.object({
        token: z.string(),
        encryptedData: z.object({
            iv: z.string(),
            encryptedData: z.string(),
            tag: z.string(),
        }),
    }),
    metadata: z.object({
        time: z.string()
    })
})

// ---

// 假设 Codec 类型
export const CodecSchema = z.object({
    mimeType: z.string(),
    fmtpLine: z.string().optional(),
});

// 假设 TimedVersion 类型
export const TimedVersionSchema = z.object({
    version: z.number(),
    timestamp: z.bigint(),
});

// 定义 Room 的 Zod 模式
// export const LivekitRoomSchema = z.object({
//     sid: z.string().optional(),
//     name: z.string().optional(),
//     emptyTimeout: z.number().optional(),
//     departureTimeout: z.number().optional(),
//     maxParticipants: z.number().optional(),
//     creationTime: z.bigint().optional(),
//     turnPassword: z.string().optional(),
//     enabledCodecs: z.array(CodecSchema).optional(),
//     metadata: z.string().optional(),
//     numParticipants: z.number().optional(),
//     numPublishers: z.number().optional(),
//     activeRecording: z.boolean().optional(),
//     version: TimedVersionSchema.optional(),
// });
export const LivekitRoomSchema = z.object({
    sid: z.any(),
    name: z.any(),
    emptyTimeout: z.any(),
    departureTimeout: z.any(),
    maxParticipants: z.any(),
    creationTime: z.any(),
    turnPassword: z.any(),
    enabledCodecs: z.any(),
    metadata: z.any(),
    numParticipants: z.any(),
    numPublishers: z.any(),
    activeRecording: z.any(),
    version: z.any(),
});

// ---

export const RoomMappingSchema = z.record(z.string().or(z.undefined())).or(z.object({}))

// ---

export const UserSymplyType = z.object({
    uid: z.number(),
    rank: z.number(),
    identity: z.string(),
    username: z.string(),
});

export const RoomMemberStatus = z.object({
    user: UserSymplyType,
    status: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    updateTime: z.number(),
    // timerId: z.instanceof(Number).optional()
    // timerId: z.instanceof(NodeJS.Timeout).optional()
    timerId: z.any().optional()
});

export const RoomParticipants = z.record(
    z.string(), // roomId
    z.array(RoomMemberStatus)
);

// ---

export const WsBasicMessageSchema = z.object({
    payload: z.object({
        sender: z.string(),
        token: z.string(),
    }),
});
export const WsBasicResponseSchema = z.object({
    timestamp: z.number(),
});
export const WsFailSchema = WsBasicResponseSchema.extend({
    event: z.literal('ERROR'),
    payload: z.object({
        error: z.string(),
        code: z.number().optional(),
    }),
    timestamp: z.number(),
})

// ---

export const GetRoomsMessageSchema = WsBasicMessageSchema.extend({
    event: z.literal('GET_ROOMS'),
});

export const GetRoomsOKSchema = WsBasicResponseSchema.extend({
    event: z.literal('GET_ROOMS'),
    payload: z.object({
        rooms: z.array(ApiRoomsResponseType),
        livekit: z.array(LivekitRoomSchema),
        mapping: RoomMappingSchema
    })
})
export const GetRoomsFailSchema = WsFailSchema.extend({
    event: z.literal('GET_ROOMS_FAIL'),
    payload: z.object({
        error: z.string()
    })
})

// ---

export const GetParticipantsMessageSchema = WsBasicMessageSchema.extend({
    event: z.literal('GET_PARTICIPANTS'),
});

export const GetParticipantsOKSchema = WsBasicResponseSchema.extend({
    event: z.literal('GET_PARTICIPANTS'),
    payload: z.object({
        participants: RoomParticipants
    })
});

export const GetParticipantsFailSchema = WsFailSchema.extend({
    event: z.literal('GET_PARTICIPANTS_FAIL'),
    payload: z.object({
        error: z.string()
    })
})

// ---

export const PreJoinRoomMessageSchema = WsBasicMessageSchema.extend({
    event: z.literal('PRE_JOIN_ROOM'),
    payload: z.object({
        sender: z.string(),
        token: z.string(),
        userInfo: z.object({
            uid: z.number(),
            rank: z.number(),
            identity: z.string(),
            username: z.string(),
        }),
        roomId: z.string(),
        roomPassword: z.string().optional(),
    })
});

export const ClientPreJoinRoomMessageSchema = WsBasicMessageSchema.extend({
    event: z.literal('CLIENT_PRE_JOIN_ROOM'),
    payload: z.object({
        sender: z.string(),
        token: z.string(),
        userInfo: z.object({
            uid: z.number(),
            rank: z.number(),
            identity: z.string(),
            username: z.string(),
        }),
        participants: RoomParticipants
    })
})

export const ClientPreJoinRoomResponseSchema = ClientPreJoinRoomMessageSchema.extend({
    event: z.literal('CLIENT_PRE_JOIN_ROOM_BOARDCAST'),
    payload: z.object({
        sender: z.string(),
        userInfo: z.object({
            uid: z.number(),
            rank: z.number(),
            identity: z.string(),
            username: z.string(),
        }),
        roomId: z.string(),
        participants: RoomParticipants
    })
})

export const PreJoinRoomOKSchema = WsBasicResponseSchema.extend({
    event: z.literal('PRE_JOIN_ROOM'),
    payload: z.object({
        type: z.literal('AFTER_CREATE').or(z.literal('DIRECT')),
        roomToken: z.string(),
        room: z.string(),
        host: z.string(),
    })
})

export const PreJoinRoomFailSchema = WsFailSchema.extend({
    event: z.literal('PRE_JOIN_ROOM_FAIL'),
    payload: z.object({
        error: z.string()
    })
})

// ---

export const JoinRoomMessageSchema = WsBasicMessageSchema.extend({
    event: z.literal('JOIN_ROOM'),
    payload: z.object({
        sender: z.string(),
        token: z.string(),
        userInfo: z.object({
            uid: z.number(),
            rank: z.number(),
            identity: z.string(),
            username: z.string(),
        }),
        roomId: z.string(),
    })
})

export const ClientJoinRoomMessageSchema = WsBasicMessageSchema.extend({
    event: z.literal('CLIENT_JOIN_ROOM'),
    payload: z.object({
        sender: z.string(),
        token: z.string(),
        userInfo: z.object({
            uid: z.number(),
            rank: z.number(),
            identity: z.string(),
            username: z.string(),
        }),
        roomId: z.string(),
    })
});

export const ClientJoinRoomResponseSchema = ClientJoinRoomMessageSchema.extend({
    event: z.literal('CLIENT_JOIN_ROOM_BOARDCAST'),
    payload: z.object({
        sender: z.string(),
        token: z.string(),
        userInfo: z.object({
            uid: z.number(),
            rank: z.number(),
            identity: z.string(),
            username: z.string(),
        }),
        roomId: z.string(),
    })
})

const JoinRoomOKSchema = WsBasicResponseSchema.extend({
    event: z.literal('JOIN_ROOM'),
    payload: z.object({
        message: z.literal('OK'),
    })
})

const JoinRoomFailSchema = WsFailSchema.extend({
    event: z.literal('JOIN_ROOM_FAIL'),
    payload: z.object({
        error: z.string()
    })
})

// ---

export const QuitRoomMessageSchema = z.object({
    event: z.literal('QUIT_ROOM'),
    payload: z.object({
        sender: z.string(),
        token: z.string(),
        userInfo: z.object({
            uid: z.number(),
            rank: z.number(),
            identity: z.string(),
            username: z.string(),
        }),
        roomId: z.string(),
    })
});

export const QuitRoomResponseSchema = WsBasicResponseSchema.extend({
    event: z.literal('CLIENT_QUIT_ROOM_BOARDCAST'),
    payload: z.object({
        sender: z.string(),
        token: z.string(),
        userInfo: z.object({
            uid: z.number(),
            rank: z.number(),
            identity: z.string(),
            username: z.string(),
        }),
        roomId: z.string(),
    })
})

// ---

export const PostRoomMessageSchema = z.object({
    event: z.literal('POST_ROOM'),
    payload: z.object({
        sender: z.string(),
        token: z.string(),
        userInfo: z.object({
            uid: z.number(),
            rank: z.number(),
            identity: z.string(),
            username: z.string(),
        }),
        createRoomInfo: RoomCreateInfo
    })
})

export const PostRoomOKSchema = WsBasicResponseSchema.extend({
    event: z.literal('POST_ROOM'),
    payload: z.object({
        message: z.literal('OK'),
    })
})

export const PostRoomFailSchema = WsFailSchema.extend({
    event: z.literal('POST_ROOM_FAIL'),
    payload: z.object({
        error: z.string()
    })
})

export const PostRoomResponseSchema = WsBasicResponseSchema.extend({
    event: z.literal('POST_ROOM_BOARDCAST'),
    payload: z.object({
        rooms: z.array(ApiRoomsResponseType),
        livekit: z.array(LivekitRoomSchema),
        mapping: RoomMappingSchema
    })
})

// ---

export const DeleteRoomMessageSchema = z.object({
    event: z.literal('DELETE_ROOM'),
    payload: z.object({
        sender: z.string(),
        token: z.string(),
        userInfo: z.object({
            uid: z.number(),
            rank: z.number(),
            identity: z.string(),
            username: z.string(),
        }),
        destroyRoomInfo: DestroyRoomInfo
    })
})

export const DeleteRoomOKSchema = WsBasicResponseSchema.extend({
    event: z.literal('DELETE_ROOM'),
    payload: z.object({
        message: z.literal('OK'),
    })
})

export const DeleteRoomFailSchema = WsFailSchema.extend({
    event: z.literal('DELETE_ROOM_FAIL'),
    payload: z.object({
        error: z.string()
    })
})

export const DeleteRoomResponseSchema = WsBasicResponseSchema.extend({
    event: z.literal('DELETE_ROOM_BOARDCAST'),
    payload: z.object({
        rooms: z.array(ApiRoomsResponseType),
        livekit: z.array(LivekitRoomSchema),
        mapping: RoomMappingSchema
    })
})

// ---

export const WsMessageSchema = z.discriminatedUnion('event', [
    GetRoomsMessageSchema,
    GetParticipantsMessageSchema,
    PreJoinRoomMessageSchema,
    JoinRoomMessageSchema,
    QuitRoomMessageSchema,
    PostRoomMessageSchema,
    DeleteRoomMessageSchema
]);

export const WsResponseSchema = z.discriminatedUnion('event', [
    GetRoomsOKSchema,
    GetRoomsFailSchema,
    GetParticipantsOKSchema,
    GetParticipantsFailSchema,
    PreJoinRoomOKSchema,
    PreJoinRoomFailSchema,
    ClientPreJoinRoomResponseSchema,
    ClientJoinRoomResponseSchema,
    JoinRoomOKSchema,
    JoinRoomFailSchema,
    QuitRoomResponseSchema,
    PostRoomOKSchema,
    PostRoomFailSchema,
    PostRoomResponseSchema,
    DeleteRoomOKSchema,
    DeleteRoomFailSchema,
    DeleteRoomResponseSchema
]);