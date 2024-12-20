export interface UserWholeType {
    uid: number;
    rank: number;
    identity: string;
    username: string;
    password: string;
    avatar: string;
    banner: string;
    email: string;
    phone: string;
    status: number;
    createTime: string;
    profile: string;
}

export interface UserInfoType {
    uid: number;
    rank: number;
    identity: string;
    username: string;
    avatar: string;
    banner: string;
    email: string;
    phone: string;
    status: number;
    createTime: string;
    profile: string;
}

export interface UserInfoWithoutPersonalInfoType {
    uid: number;
    rank: number;
    identity: string;
    username: string;
    avatar: string;
    banner: string;
    createTime: string;
    profile: string;
}

export interface UserSymplyType {
    uid: number;
    rank: number; // 0 游客 1 成员 2 管理员 3 高级管理员 4 服务器管理员
    identity: string;
    username: string;
}