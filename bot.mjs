import makeWASocket, {
useMultiFileAuthState
} from "@whiskeysockets/baileys"

import express from "express"
import fs from "fs"
import QRCode from "qrcode"
import pino from "pino"

const app = express()

app.use(express.json())
app.use(express.static("dashboard"))

let currentQR = null

function loadDB(){
return JSON.parse(fs.readFileSync("./database.json"))
}

function saveDB(db){
fs.writeFileSync("./database.json",JSON.stringify(db,null,2))
}

function isAllowed(user,command,db){

if(db.owners.includes(user)) return true

if(db.permissions[command]){
return db.permissions[command].includes(user)
}

return false
}

async function startBot(){

const {state,saveCreds} = await useMultiFileAuthState("auth")

const sock = makeWASocket({
auth:state,
logger:pino({level:"silent"})
})

sock.ev.on("creds.update",saveCreds)

sock.ev.on("connection.update",async(update)=>{

const {connection,qr} = update

if(qr){
currentQR = await QRCode.toDataURL(qr)
}

if(connection==="close"){
startBot()
}

if(connection==="open"){
console.log("BOT CONNECTED")
}
})

sock.ev.on("messages.upsert", async ({messages})=>{

let m = messages[0]
if(!m.message) return

let sender = m.key.remoteJid
let senderUser = m.key.participant || sender

let text =
m.message.conversation ||
m.message.extendedTextMessage?.text ||
""

text = text.toLowerCase()

let db = loadDB()

if(!text.startsWith("!")) return

let cmd = text.split(" ")[0]

/* WARN */

if(cmd==="!warn"){

if(!isAllowed(senderUser,"warn",db)) return

let target = m.message.extendedTextMessage.contextInfo.participant

db.warnings[target] = (db.warnings[target] || 0)+1

await sock.sendMessage(sender,{
text:`⚠ Warning ${db.warnings[target]}/3`
})

if(db.warnings[target] >=3){
await sock.sendMessage(sender,{text:"User auto banned"})
}

saveDB(db)
}

/* VIEW ONCE */

if(cmd==="!vv"){

let quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage

if(!quoted) return

let buffer = await sock.downloadMediaMessage({
message: quoted
})

await sock.sendMessage(sender,{
image:buffer,
caption:"View Once Saved"
})
}

/* PROFILE PIC */

if(cmd==="!pp"){

let target =
m.message.extendedTextMessage?.contextInfo?.participant ||
senderUser

try{

let url = await sock.profilePictureUrl(target,"image")

await sock.sendMessage(sender,{
image:{url:url}
})

}catch{
sock.sendMessage(sender,{text:"No profile photo"})
}
}

/* STICKER */

if(cmd==="!sticker" || cmd==="!s"){

let quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage

if(!quoted) return

let buffer = await sock.downloadMediaMessage({
message:quoted
})

await sock.sendMessage(sender,{
sticker:buffer
})
}

})

}

/* DASHBOARD API */

/* LOGIN */

app.post("/login",(req,res)=>{

let db = loadDB()

if(req.body.password === db.dashboard.password){

return res.json({success:true})

}else{

return res.json({success:false})
}

})

/* GET QR */

app.get("/qr",(req,res)=>{

if(!currentQR){
return res.send("QR not ready")
}

res.send(`<img src="${currentQR}"/>`)
})

/* PERMISSIONS */

app.post("/allow",(req,res)=>{

let db = loadDB()

let {number,command} = req.body

number = number+"@s.whatsapp.net"

if(!db.permissions[command]){
db.permissions[command] = []
}

db.permissions[command].push(number)

saveDB(db)

res.json({status:"granted"})
})

app.listen(3000,()=>{
console.log("Dashboard running on port 3000")
})

startBot()