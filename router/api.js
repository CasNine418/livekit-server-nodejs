import express, { response } from 'express';
import clg from '../utils/clg.js';
import config from '../config.js';
import db from '../db/index.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

router.get('/', (req, res)=>{
    res.send(JSON.stringify({
        message: 'Api Router'
    }));
})

router.get('/userinfo', (req, res)=>{
    // const { identity } = req.body;

    const _params = {};
    const params = req.url.substring(req.url.indexOf('?') + 1);
    params.split('&').forEach(item =>{
        const t = item.split('=');
        _params[t[0]] = t[1];
    })

    let identity = _params.identity;

    let sqlSearcidentity = `SELECT * FROM accounts WHERE identity = ?`;
    db.promise().query(sqlSearcidentity, [identity])
    .then((response) =>{
        if(response[0][0] != undefined){
            let resData = {
                uid: response[0][0].uid,
                identity: response[0][0].identity,
                username: response[0][0].username,
                avatar: response[0][0].avatar,
                banner: response[0][0].banner,
                profile: response[0][0].profile
            }
            res.send(JSON.stringify({
                message: 'Request Successful',
                data: resData,
            }))
        } else {
            res.status(404).send(JSON.stringify({
                message: 'Request Failed'
            }))
        }
    })
    .catch((err)=>{
        clg(`Error: ${err}`,'ERROR','ServerProcess');
        res.status(500).send(JSON.stringify({
            message: 'Server error'
        }))
    })
})

router.post('/changeuserinfo', (req, res) =>{
    const { uid, identity, username, avatar, banner, profile } = req.body;

    if (!uid || !identity || !username){  
        return res.status(400).send(JSON.stringify({
            message: 'Missing required fields'
        }));
    }

    let sqlUpdateUserInfo = `UPDATE accounts SET identity = ?, username = ?, avatar = ?, banner = ?, profile = ? WHERE uid = ?`;  

    db.promise().query(sqlUpdateUserInfo, [identity, username, avatar, banner, profile])  
    .then(() =>{
        res.send(JSON.stringify({
            message: 'User information updated successfully' 
        }));
    })
    .catch((err) => {
        clg(`Error updating user info: ${err}`, 'ERROR', 'ServerProcess');
        res.status(500).send(JSON.stringify({
            message: 'Server error'
        }));
    });
});

export default router;