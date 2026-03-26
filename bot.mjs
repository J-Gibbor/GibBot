import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, downloadContentFromMessage } from '@whiskeysockets/baileys';
import P from 'pino';
import express from 'express';
import session from 'express-session';
import fs from 'fs';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import fetch from 'node-fetch';

// ===== CONFIG =====
const OWNER = '2349021540840';
const ADMIN_PASSWORD = 'BellaAdmin';
const AUTH_FOLDER = 'auth_info_multi';
const PORT = process.env.PORT || 3000;

// ===== INIT =====
if(!fs.existsSync('./media')) fs.mkdirSync('./media');
if(!fs.existsSync('./commands.json')) fs.writeFileSync('./commands.json', JSON.stringify({admin:{},fun:{},tools:{}}));
if(!fs.existsSync('./users.json')) fs.writeFileSync('./users.json', JSON.stringify({banned:[]}));
if(!fs.existsSync('./settings.json')) fs.writeFileSync('./settings.json', JSON.stringify({botMode:'private'}));

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret:'secret-key', resave:false, saveUninitialized:true }));

// ===== GLOBALS =====
let sock;
let currentQR = null;
let connectionStatus = 'disconnected';

// ===== FILE HELPERS =====
const readJSON=(f,d)=>{ if(!fs.existsSync(f)) fs.writeFileSync(f,JSON.stringify(d,null,2)); return JSON.parse(fs.readFileSync(f)); };
const writeJSON=(f,d)=>fs.writeFileSync(f,JSON.stringify(d,null,2));
const getCommands=()=>readJSON('./commands.json',{admin:{},fun:{},tools:{}});
const getUsers=()=>readJSON('./users.json',{banned:[]});
const getSettings=()=>readJSON('./settings.json',{botMode:'private'});

// ===== AUTH =====
const authMiddleware = (req,res,next)=>req.session.loggedIn?next():res.redirect('/login');

// ===== LOGIN =====
app.get('/login',(req,res)=>{
    res.send(`<style>body{text-align:center;font-family:Arial;margin-top:100px}input,button{padding:10px;margin:5px}</style>
    <h2>Bot Admin Login</h2>
    <form method="POST">
        <input type="password" name="password" placeholder="Enter password"/>
        <button>Login</button>
    </form>`);
});
app.post('/login',(req,res)=>{
    if(req.body.password===ADMIN_PASSWORD){ req.session.loggedIn=true; res.redirect('/'); }
    else res.send('Wrong password'); 
});
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ===== DASHBOARD =====
app.get('/', authMiddleware, (req,res)=>{
    const cmds=getCommands();
    const users=getUsers();
    const settings=getSettings();
    const mediaFiles = fs.readdirSync('./media').filter(f=>f.endsWith('.jpg')||f.endsWith('.mp4'));

    res.send(`
    <style>
    body{font-family:Arial;background:#f4f4f4;padding:20px}
    .card{background:#fff;padding:20px;border-radius:10px;margin-bottom:20px}
    button{padding:8px 15px;margin:5px} input{padding:8px;margin:5px}
    .status{font-weight:bold}
    .gallery img, .gallery video{width:150px;margin:5px;border-radius:10px}
    </style>

    <h1>🤖 Bot Dashboard</h1>
    <a href="/logout">Logout</a>
    <p>Connection Status: <span class="status">${connectionStatus}</span></p>
    <a href="/qr" target="_blank"><button>📱 Show QR Code</button></a>

    <div class="card">
        <h2>Bot Mode</h2>
        <p><b>${settings.botMode}</b></p>
        <form method="POST" action="/toggle-mode"><button>Toggle Mode</button></form>
    </div>

    <div class="card">
        <h2>Add Command</h2>
        <form method="POST" action="/add-command">
            <input name="category" placeholder="category"/>
            <input name="command" placeholder="!cmd"/>
            <input name="response" placeholder="response"/>
            <button>Add</button>
        </form>
    </div>

    <div class="card">
        <h2>Commands</h2>
        ${Object.keys(cmds).map(cat=>`<h3>${cat}</h3>${Object.keys(cmds[cat]).map(c=>`<p>${c} → ${cmds[cat][c]} <a href="/delete/${cat}/${encodeURIComponent(c)}">❌</a></p>`).join('')}`).join('')}
    </div>

    <div class="card">
        <h2>User Management</h2>
        <form method="POST" action="/ban"><input name="number" placeholder="2349021540840"/><button>Ban</button></form>
        <ul>${users.banned.map(u=>`<li>${u} <a href="/unban/${u}">Unban</a></li>`).join('')}</ul>
    </div>

    <div class="card">
        <h2>Broadcast</h2>
        <form method="POST" action="/broadcast"><input name="msg" placeholder="message"/><button>Send</button></form>
    </div>

    <div class="card gallery">
        <h2>Saved Media Gallery</h2>
        ${mediaFiles.map(f=>f.endsWith('.mp4')?`<video src="/media/${f}" controls></video>`:`<img src="/media/${f}" />`).join('')}
    </div>
    `);
});

// ===== DASHBOARD ROUTES =====
app.post('/toggle-mode', authMiddleware, (req,res)=>{
    let s=getSettings(); s.botMode = s.botMode==='private'?'public':'private'; writeJSON('./settings.json',s); res.redirect('/');
});
app.post('/add-command', authMiddleware, (req,res)=>{
    const {category,command,response} = req.body; let cmds=getCommands(); if(!cmds[category]) cmds[category]={}; cmds[category][command]=response; writeJSON('./commands.json',cmds); res.redirect('/');
});
app.get('/delete/:cat/:cmd', authMiddleware, (req,res)=>{ let cmds=getCommands(); delete cmds[req.params.cat][req.params.cmd]; writeJSON('./commands.json',cmds); res.redirect('/'); });
app.post('/ban', authMiddleware, (req,res)=>{ let users=getUsers(); users.banned.push(req.body.number+'@s.whatsapp.net'); writeJSON('./users.json',users); res.redirect('/'); });
app.get('/unban/:num', authMiddleware, (req,res)=>{ let users=getUsers(); users.banned = users.banned.filter(u=>u!==req.params.num); writeJSON('./users.json',users); res.redirect('/'); });
app.post('/broadcast', authMiddleware, async (req,res)=>{ try{ await sock.sendMessage(OWNER+'@s.whatsapp.net',{text:req.body.msg}); }catch{} res.redirect('/'); });

// ===== MEDIA SERVE =====
app.use('/media', express.static('./media'));

// ===== LIVE QR =====
app.get('/qr', authMiddleware, async (req,res)=>{
    if(!currentQR) return res.send('<h3>✅ Already connected or no QR available</h3>');
    const qrImage = await QRCode.toDataURL(currentQR);
    res.send(`<html><head><meta http-equiv="refresh" content="5"><style>body{text-align:center;font-family:Arial;margin-top:50px}</style></head>
        <body><h2>Scan QR Code</h2><img src="${qrImage}" /><p>Open WhatsApp → Linked Devices → Scan</p><p>Page refreshes every 5s until connected</p></body></html>`);
});

// ===== START BOT =====
async function startBot(){
    const {state,saveCreds}=await useMultiFileAuthState(AUTH_FOLDER);
    const {version}=await fetchLatestBaileysVersion();

    sock=makeWASocket({logger:P({level:'silent'}), auth:state, version});

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update)=>{
        const {connection, qr}=update;
        connectionStatus = connection==='open'?'connected':connection==='close'?'disconnected':'connecting';

        if(qr){ currentQR = qr; qrcode.generate(qr,{small:true}); }

        if(connection==='close'){ console.log('❌ Connection closed, reconnecting...'); setTimeout(startBot,5000); }
        if(connection==='open'){ console.log('✅ Connected'); currentQR=null; }
    });

    sock.ev.on('messages.upsert', async ({messages})=>{
        const msg=messages[0];
        if(!msg.message || msg.key.fromMe) return;

        const sender=msg.key.remoteJid;
        const text=msg.message.conversation || msg.message.extendedTextMessage?.text;
        const users=getUsers();
        const settings=getSettings();
        const cmds=getCommands();
        if(users.banned.includes(sender)) return;
        if(settings.botMode==='private' && !sender.includes(OWNER)) return;

        // ===== !VV COMMAND =====
        if(text==='!vv'){
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if(!quoted){ await sock.sendMessage(sender,{text:'↩️ Reply to a message with !vv'}); return; }
            const isVO = quoted?.viewOnceMessage || quoted?.viewOnceMessageV2 || quoted?.viewOnceMessageV2Extension;
            if(isVO){
                const inner=quoted?.viewOnceMessage?.message || quoted?.viewOnceMessageV2?.message || quoted?.viewOnceMessageV2Extension?.message;
                const type=inner?Object.keys(inner)[0]:'unknown';
                await sock.sendMessage(OWNER+'@s.whatsapp.net',{text:`👁️ !vv attempted on view-once (${type}) from ${sender}`});
                await sock.sendMessage(sender,{text:`👁️ Detected view-once ${type}.\n⚠️ Cannot be saved due to privacy restrictions.`}); return;
            }
            // Save normal media
            const type=Object.keys(quoted)[0];
            try{
                let buffer,mime,ext;
                if(type==='imageMessage'){
                    const stream=await downloadContentFromMessage(quoted.imageMessage,'image');
                    buffer=Buffer.from([]); for await(const c of stream) buffer=Buffer.concat([buffer,c]); mime='image/jpeg'; ext='jpg';
                } else if(type==='videoMessage'){
                    const stream=await downloadContentFromMessage(quoted.videoMessage,'video');
                    buffer=Buffer.from([]); for await(const c of stream) buffer=Buffer.concat([buffer,c]); mime='video/mp4'; ext='mp4';
                } else { await sock.sendMessage(sender,{text:'❌ Unsupported message type'}); return; }
                fs.writeFileSync(`./media/vv_${Date.now()}.${ext}`, buffer);
                await sock.sendMessage(sender,{document:buffer,mimetype:mime,fileName:`vv.${ext}`});
            }catch(e){ await sock.sendMessage(sender,{text:'❌ Failed to save media'}); }
        }

        // ===== PROFILE PIC SAVER =====
        if(text==='!saveprofile'){
            try{
                const url=await sock.profilePictureUrl(sender,'image');
                const res=await fetch(url); const buffer=await res.arrayBuffer();
                const filePath=`./media/profile_${Date.now()}.jpg`; fs.writeFileSync(filePath, Buffer.from(buffer));
                await sock.sendMessage(sender,{text:'✅ Profile saved'});
                await sock.sendMessage(sender,{image:fs.readFileSync(filePath),caption:'📸 Profile picture'});
            }catch{ await sock.sendMessage(sender,{text:'❌ No profile picture'}); }
        }

        // ===== AUTO MEDIA LOGGER =====
        const mType = Object.keys(msg.message || {})[0];
        const isVO = msg.message?.viewOnceMessage || msg.message?.viewOnceMessageV2 || msg.message?.viewOnceMessageV2Extension;
        if(!isVO && (mType==='imageMessage'||mType==='videoMessage')){
            const media=msg.message[mType];
            const stream=await downloadContentFromMessage(media, mType==='imageMessage'?'image':'video');
            let buffer=Buffer.from([]); for await(const c of stream) buffer=Buffer.concat([buffer,c]);
            const ext = mType==='imageMessage'?'jpg':'mp4';
            fs.writeFileSync(`./media/auto_${Date.now()}.${ext}`, buffer);
        }

        // ===== DYNAMIC COMMANDS =====
        for(let cat in cmds){ if(cmds[cat][text]) await sock.sendMessage(sender,{text:cmds[cat][text]}); }
    });
}

startBot();
app.listen(PORT,()=>console.log('🚀 Dashboard running on port '+PORT));