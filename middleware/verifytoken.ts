import jwt, { Jwt, JwtPayload } from 'jsonwebtoken';
import config from '../app_options';
import Clg from '../utils/clg';
import { Request, Response, NextFunction } from 'express';

/**
 * 验证token中间件
 */
const verifyToken = (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
        .then(() => {
            const authHeader = req.headers.authorization as string | undefined;
            const token = authHeader?.split(' ')[1];
        
            if (token == null) {
                Clg.error('Err: Token null', 'VerifyToken');
                return res.status(401).json({
                    message: 'Unauthorized',
                });
            }
        
            jwt.verify(token, config.jwtSecretKey, (err: any, user: any) => {
                if (err) {
                    Clg.error('Err: Token Unauthorized', 'VerifyToken');
                    return res.status(401).json({
                        message: 'Unauthorized',
                    });
                }
                req.user = user;
                next();
            });
        })
};

/**
 * 返回解密后的token
 * @param token 
 * @returns decodeData
 */
const decodeTokenUser = (token: string) => {
    const decodeData = jwt.decode(token);
    if(decodeData && typeof decodeData === 'object') {
        return decodeData;
    } else {
        return null;
    }
}

export { verifyToken, decodeTokenUser };