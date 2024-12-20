export interface roomsResponseType {
    id: number;
    name: string;
    rank: number;
    is_delete: number;
    created_at: string;
    updated_at: string;
    room_options: string;
}

export interface roomJoinTokenResponseType {
    token: string;
    verifyData: {
        iv: string;
        encryptedData: string;
        tag: string;
    }
}