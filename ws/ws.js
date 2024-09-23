import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import https from 'https';
import fs from 'fs';
import clg from '../utils/clg.js';
import config from '../config.js';

const wsPort = config.wsPort;

// const clients = new Set();
const clients = new Map();

const sslOptions  = {
    key: fs.readFileSync('./cert/privkey.key'), // 私钥
    cert: fs.readFileSync('./cert/domain.crt'), // 证书 
    ca: [fs.readFileSync('./cert/root_bundle.crt')] // CA
}

const httpsServer = https.createServer(sslOptions, (req, res) => {  
    res.writeHead(200);  
    res.end('WebSocket server only.');  
});  

const wss = new WebSocketServer({ server: httpsServer });  

httpsServer.listen(wsPort, () => {  
    clg(`WebSocket Secure Server is running at port ${wsPort}`, 'INFO', 'ServerStart');  
}); 

// const wss = new WebSocketServer({ port: wsPort }, ()=>{
//     clg(`WebSocket Server is running at port ${wsPort}`, 'INFO','ServerStart');
// });

// const onConnection = () =>{
//     wss.on('connection', function connenction(ws, req){
//         const _params = {}
//         const params = req.url.substring(req.url.indexOf('?') + 1)
//         params.split('&').forEach(item => {
//             const t = item.split('=')
//             _params[t[0]] = t[1]
//         })

//         clients.add('user', _params.identity);
//         console.log(JSON.stringify(clients));
//         ws.send('ok')
//         ws.on('message', function message(res){
//             const message = res.toString();
//             wss.clients.forEach(client =>{

//             })
//         })
//     })
// }

const onConnection = () =>{
    wss.on('connection', function connection(ws, request) {    
        const _params = {}
        const params = request.url.substring(request.url.indexOf('?') + 1)
        params.split('&').forEach(item => {
            const t = item.split('=')
            _params[t[0]] = t[1]
        })
        
        if(_params.identity == undefined){
            const errorBack = {
                code: 'error',
                data: {
                    message: `Error: need identity`,
                }
            }
            ws.send(JSON.stringify(errorBack));
            clg(`Error: need identity`,'Error','WebSocketServer');
            ws.close();
            return 1;
        }
        const identity = _params.identity;
        const onConnectionSendBack = {
            code: 'link_start',
            data: {
                message: 'WebSocket established',
                from_identity: identity,
            },
        }
        ws.send(JSON.stringify(onConnectionSendBack));
        clients.forEach((otherWs, otherIdentity) => {  
            if (otherIdentity !== identity && otherWs.readyState === WebSocket.OPEN) {  
                otherWs.send(JSON.stringify(onConnectionSendBack));  
            }  
        }); 
        if(clients.has(identity)){
            clg(`Error: identity ${identity} already exists`,'ERROR','WebSocketServer');
            const errorBack = {
                code: 'error',
                data: {
                    message: `Error: identity ${identity} already exists`,
                }
            }
            ws.send(JSON.stringify(errorBack));
            ws.close();
        } else {
            clients.set(identity, ws);
            clg(`[${identity}] client connected`,'INFO','WebSocketServer');  
            ws.on('message', function incoming(res) {
                const message = res.toString();
                let varOut;
                try{
                    const { code, data } = JSON.parse(message);
                    varOut = {
                        c: code,
                        d: data
                    }
                } catch(err){
                    const errorBack = {
                        code: 'error',
                        data: {
                            message: 'Incorrect message',
                        }
                    }
                    ws.send(JSON.stringify(errorBack));
                    ws.close();
                    clg(`Error: ${err}`,'ERROR','WebSocketServer');
                    return 1;
                }
                // Chat in
                if(varOut.c === 'chat_out'){
                    const sendBack = {
                        code: 'chat_in',
                        data: {
                            message: varOut.d.message,
                            from_identity: identity,
                        }
                    }
                    clients.forEach((otherWs, otherIdentity) => {  
                        if (otherIdentity !== identity && otherWs.readyState === WebSocket.OPEN) {  
                            otherWs.send(JSON.stringify(sendBack));  
                        }  
                    }); 
                }
                // Default
                else {
                    const errorBack = {
                        code: 'error',
                        data: {
                            message: 'Incorrect code',
                        }
                    }
                    ws.send(JSON.stringify(errorBack));
                    clg(`Incorrect code`,'ERROR','WebSocketServer');  
                }
            });  
          
            ws.on('close', function clear() {  
                clients.delete(identity);  
                clg(`[${identity}] client disconnected`,'INFO','WebSocketServer');  
                const closeBack = {
                    code: 'link_end',
                    data: {
                        message: `[${identity}] client disconnected`,
                        from_identity: identity,
                    }
                }
                clients.forEach((otherWs, otherIdentity) => {  
                    if (otherIdentity !== identity && otherWs.readyState === WebSocket.OPEN) {  
                        otherWs.send(JSON.stringify(closeBack));  
                    }  
                }); 
            });

            ws.on('error', (err)=> clg(`Error: ${err}`,'ERROR','WebSocketServer'));
        }      
    }); 
}

export { onConnection };