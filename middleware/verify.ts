import jwt, { Jwt, JwtPayload } from 'jsonwebtoken';
import config from '../app_options';
import { Logger } from 'tslog'
const Log = new Logger({ name: 'verify.ts' });
import { Request, Response, NextFunction } from 'express';
import { buildErrorResponse } from '../utils/buildResponse';
import { sendErrorResponse } from '../utils/sendMessage';
import bcrypt from 'bcryptjs';

const verify = (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(() => {
            const authHeader = req.headers.authorization as string | undefined;
            const token = authHeader ? authHeader.split(' ')[1] : undefined;

            if (!token) {
                Log.error('No token provided');
                return sendErrorResponse(res, 401, 'Unauthorized', 401)
            }

            // jwt.verify
            jwt.verify(token, config.jwtSecretKey, (err: any, user: any) => {
                if (err) {
                    Log.error('Failed to authenticate token');
                    return sendErrorResponse(res, 401, 'Unauthorized', 401)
                } else {
                    req.user = user;
                    next();
                }
            })
        })
};

const decodeToken = (token: string) => {
    const data = jwt.decode(token);
    if (data && typeof data === 'object') {
        return data;
    } else {
        return null;
    }
}

const verifyPassword = async (password: string, hash: string) => {
    try {  
        const isMatch = await bcrypt.compare(password, hash);  
        return isMatch;  
    } catch (err: any) {  
        throw new Error('Error verifying password: ' + err.message);  
    }  
}

const hashPassword = async (funcPassword: string) =>{
    try {  
        const saltRounds = 10; 
        const hashedPassword = await bcrypt.hash(funcPassword, saltRounds);  
        return hashedPassword;  
    } catch (err: any) {  
        throw new Error('Error hashing password: ' + err.message);  
    }  
}

export { verify, decodeToken, verifyPassword, hashPassword }