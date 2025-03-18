import { Response } from 'express';
import { buildErrorResponse, buildResponse } from './buildResponse';

enum ErrorCodeNumber {
    DatabaseNotInitialized = 0,
    InvalidRequestBody = 1,
    UserAlreadyExists = 2,
    ErrorRegisteringUser = 3,
    InvalidPassword = 4,
    ErrorVerifyingPassword = 5,
    ErrorLoggingInUser = 6,
    InvalidApiToken = 7,
    ErrorOccurredWhileQueryingUserInformation = 8,
    InternalServerError = 9
}

const sendOkResponse = (res: Response, message: string, data: any) => {
    res.status(200).json(buildResponse<any, any>(message, data, { time: new Date().toISOString() }));
};

const sendErrorResponse = (res: Response, httpCode: number, message: string, errorCode: number) => {
    res.status(httpCode).json(buildErrorResponse<any, any>(message, { code: errorCode }, { time: new Date().toISOString() }));
};

export { ErrorCodeNumber, sendOkResponse, sendErrorResponse };