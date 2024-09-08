import jwt from 'jsonwebtoken';
import config from '../config.js';
import clg from "../utils/clg.js";

// 验证信息中间件
function verifyToken(req, res, next){
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null){
        clg('Err: Token null','Error', 'ServerProcess');
        return res.status(401).send(JSON.stringify({
            message: 'Unauthorized',
        }))
    }

    jwt.verify(token, config.jwtSecretKey, (err, user) =>{
        if (err) {
            clg('Err: Token Unauthorized','Error', 'ServerProcess');
            return res.status(401).send(JSON.stringify({
                message: 'Unauthorized',
                apiToken: token
            }))
        };
        req.user = user;
        next();
    });
}

export default verifyToken;