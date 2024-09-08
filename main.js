import express from 'express';
import cors from 'cors';
import clg from './utils/clg.js';
import config from './config.js';
import https from 'https';
import fs from 'fs';
import db from './db/index.js';
// import db from './db/index.js';
import jwt from 'jsonwebtoken';
import { expressjwt } from 'express-jwt';
import bcrypt from 'bcrypt';

const app = express();
app.use(cors());
app.use(express.json());
const port = config.port;

// 密码加盐
const hashPassword = async (funcPassword) =>{
    try {  
        const saltRounds = 10; 
        const hashedPassword = await bcrypt.hash(funcPassword, saltRounds);  
        return hashedPassword;  
    } catch (err) {  
        throw new Error('Error hashing password: ' + err.message);  
    }  
}

// 验证密码
const verifyPassword = async (userPassword, hashedPassword) =>{  
    try {  
        const isMatch = await bcrypt.compare(userPassword, hashedPassword);  
        return isMatch;  
    } catch (err) {  
        throw new Error('Error verifying password: ' + err.message);  
    }  
}

import verifyToken from './middleware/verifytoken..js';

app.post('/register', async (req, res) =>{
    const { identity, password } = req.body;
    
    let sqlSearcidentity = `SELECT * FROM accounts WHERE identity = ?`;
    db.promise().query(sqlSearcidentity, [identity])
    .then((response) =>{
        if(response[0][0] == undefined){
            let hashedPassword = '';
            hashPassword(password)
            .then(returnPassword =>{
                // console.log(hashedPassword);
                hashedPassword = returnPassword;
                const sqlRegister = `INSERT INTO accounts (identity, username, password) VALUES ( ?, ?, ?);`
                db.promise().query(sqlRegister, [identity, identity, hashedPassword])
                .then((responseIn) =>{
                    clg('Register OK','INFO','ServerProcess');
                    res.status(200).send(JSON.stringify({
                        data: 'identity OK'
                    }))
                })
                .catch((err)=>{
                    clg(`Error: ${err}`,'ERROR','ServerProcess');
                    res.status(400).send(JSON.stringify({
                        data: 'Failed'
                    }))
                })
            })
            .catch((err)=>{
                clg(`Error: ${err}`,'ERROR','ServerProcess');
                res.status(400).send(JSON.stringify({
                    data: 'Failed'
                }))
            })
            
        } 
        if(response[0][0] != undefined){
            res.status(403).send(JSON.stringify({
                data: 'identity deny'
            }))
        }
    })
})

app.post('/login', (req, res) =>{
    const { identity, password } = req.body;

    let sqlSearcidentity = `SELECT * FROM accounts WHERE identity = ?`;

    db.promise().query(sqlSearcidentity, [identity])
    .then((response) =>{
        if(response[0][0] != undefined){
            verifyPassword(password ,response[0][0].password)
            .then((isValidPassword) =>{
                if(isValidPassword){
                    const token = jwt.sign({ identity: identity }, config.jwtSecretKey, { expiresIn: config.expiresIn });
                    clg(`User: ${identity} login`,'INFO','ServerProcess');
                    res.status(200).send(JSON.stringify({
                        message: 'Login Success',
                        apiToken: token
                    }));
                } else {
                    clg(`Login Deny`,'ERROR','ServerProcess');
                    res.status(403).send(JSON.stringify({
                        message: 'Login Failed',
                    }))
                }
            })
            .catch((err)=>{
                clg(`Error: ${err}`,'ERROR','ServerProcess');
                res.status(500).send({
                    message: 'Server Error'
                })
            })
        }
    })
})

app.post('/isTokenExpired', (req, res)=>{
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null){
        clg('Err: TokenExpired(Token Missing)','Error', 'ServerProcess');
        return res.status(401).send(JSON.stringify({
            message: 'Token Missing',
        }))
    }

    jwt.verify(token, config.jwtSecretKey, (err, user) =>{
        if (err){  
            if (err.name === 'TokenExpiredError'){  
                clg('Err: Token Expired','Error', 'ServerProcess');  
                return res.status(401).send(JSON.stringify({  
                    message: 'Token Expired',  
                }));  
            } else {  
                clg('Err: Token Unauthorized','Error', 'ServerProcess');  
                return res.status(401).send(JSON.stringify({  
                    message: 'Unauthorized: Invalid token',  
                }));  
            }  
        }  
  
        clg('Info: Token Valid','Info', 'ServerProcess');  
        res.send(JSON.stringify({  
            message: 'Token is valid',  
        }));  
    });
})

// Api Router
import apiRouter from './router/api.js';
app.use('/api', verifyToken, apiRouter);

// Server Router
import serverRouter from './router/server.js'
app.use('/server', verifyToken, serverRouter);

// Server.js

// app.listen(port,() =>{
//     clg(`Server is running at port ${port}`, 'INFO','ServerStart');
// })

const httpsOptions = {
    key: fs.readFileSync('./cert/privkey.key'), // 私钥
    cert: fs.readFileSync('./cert/domain.crt'), // 证书 
    ca: [fs.readFileSync('./cert/root_bundle.crt')] 
}

https.createServer(httpsOptions, app).listen(port, ()=>{
    console.log('LiveKit Node Server v0.0.1');
    clg(`Server is running at port ${port}`, 'INFO', 'ServerStart'); 
})