import { date, z } from "zod";

// Basic types

export const MessageType = z.union([z.literal('text'), z.literal('image'), z.literal('video'), z.literal('file'), z.literal('error'), z.literal('welcome')]);

export const BasicMessageSchema = z.object({
    uuid: z.string(),
    type: MessageType,
    timestamp: z.number(),
    senderUuid: z.string()
});

export const TextMessageSchema = BasicMessageSchema.extend({
    type: z.literal('text'),
    data: z.string()
});

export const ImageMessageSchema = BasicMessageSchema.extend({
    type: z.literal('image'),
    data: z.union([
        z.object({ content: z.string(), url: z.string().optional() }),
        z.object({ content: z.string().optional(), url: z.string() })
    ])
});

export const VideoMessageSchema = BasicMessageSchema.extend({
    type: z.literal('video'),
    data: z.union([
        z.object({ content: z.string(), url: z.string().optional() }),
        z.object({ content: z.string().optional(), url: z.string() })
    ])
});

export const FileMessageSchema = BasicMessageSchema.extend({
    type: z.literal('file'),
    data: z.object({
        content: z.string(),
        url: z.string(),
        name: z.string(),
        size: z.number(),
        type: z.string()
    })
});

export const ErrorMessageSchema = BasicMessageSchema.extend({
    type: z.literal('error'),
    data: z.object({
        description: z.string(),
        code: z.number().optional()
    })
});

export const WelcomeMessageSchema = BasicMessageSchema.extend({
    type: z.literal('welcome'),
    data: z.object({
        serverUuid: z.string(),
        serverStartAt: z.any(),
        lastMessageUuid: z.string(),
        serverMessagesFlow: z.any()
    })
});

export const ChatServerMessageSchema = z.union([
    TextMessageSchema,
    ImageMessageSchema,
    VideoMessageSchema,
    FileMessageSchema,
    ErrorMessageSchema,
    WelcomeMessageSchema
]);

// Server Calls