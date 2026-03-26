import makeWASocket,{
useMultiFileAuthState,
fetchLatestBaileysVersion,
DisconnectReason,
downloadContentFromMessage
} from "@whiskeysockets/baileys"

import express from "express"
import P from "pino"
import qrcode from "qrcode-terminal"
import QRCode from "qrcode"

////////////////////////////////////////////////////

const PREFIX="."
const DASH_PASSWORD="RoseBella"
const PORT=process.env.PORT||3000

////////////////////////////////////////////////////

let owners=["2349021540840@s.whatsapp.net"]
let blockedUsers=[]
let customCommands={}

let settings={
antilink:false,
welcome:false,
goodbye:false,
autoreply:true,
autolock:false
}

let botSettings={
mode:"public",
warnLimit:3
}

let warnings={}
let stats={messages:0,commands:0}

let qrImage=null
let pairingCode=null
let botStatus="offline"

let sock

////////////////////////////////////////////////////
//////////////// HELPER FUNCTIONS //////////////////
////////////////////////////////////////////////////

function isOwner(user){
return owners.includes(user)
}

async function isAdmin(group,user){

try{
let meta=await sock.groupMetadata(group)

let admins=meta.participants
.filter(p=>p.admin)
.map(p=>p.id)

return admins.includes(user)

}catch{
return false
}

}

////////////////////////////////////////////////////
//////////////// WEB DASHBOARD /////////////////////
////////////////////////////////////////////////////

const app=express()
app.use(express.json())
app.use(express.urlencoded({extended:true}))

let logged=false

app.get("/",(req,res)=>{

if(!logged){

return res.send(`
<h2>Gibborlee Bot Dashboard Login</h2>
<form method="POST" action="/login">
<input type="password" name="password">
<button>Login</button>
</form>
`)

}

res.send(`
<h1>🌌 Gibborlee Bot Dashboard</h1>

<p>Status: ${botStatus}</p>

<img src="${qrImage||""}" width="250"/>

<h3>Pairing Code: ${pairingCode||"None"}</h3>

<hr>

<h2>Bot Mode</h2>
<button onclick="toggleMode()">Toggle Mode</button>

<h2>Warn Limit</h2>
<input id="limit">
<button onclick="setLimit()">Update</button>

<h2>AntiLink</h2>
<button onclick="toggleAnti()">Toggle</button>

<hr>

<h2>Owner Manager</h2>

<input id="own">
<button onclick="addOwner()">Add</button>
<button onclick="removeOwner()">Remove</button>

<div id="owners"></div>

<hr>

<h2>Create Command</h2>

<input id="cmd" placeholder="command name">
<input id="reply" placeholder="reply text">
<button onclick="createCmd()">Create</button>

<hr>

<h2>Block User</h2>

<input id="user">
<button onclick="block()">Block</button>

<script>

async function toggleMode(){
await fetch("/toggle-mode",{method:"POST"})
}

async function toggleAnti(){
await fetch("/toggle-antilink",{method:"POST"})
}

async function setLimit(){

let l=document.getElementById("limit").value

await fetch("/warnlimit",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({limit:l})
})

}

async function addOwner(){

let n=document.getElementById("own").value

await fetch("/add-owner",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({number:n})
})

}

async function removeOwner(){

let n=document.getElementById("own").value

await fetch("/remove-owner",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({number:n})
})

}

async function createCmd(){

let c=document.getElementById("cmd").value
let r=document.getElementById("reply").value

await fetch("/create-command",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({cmd:c,reply:r})
})

}

async function block(){

let u=document.getElementById("user").value

await fetch("/block-user",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({user:u})
})

}

</script>
`)
})

app.post("/login",(req,res)=>{
if(req.body.password===DASH_PASSWORD){
logged=true
res.redirect("/")
}else{
res.send("Wrong password")
}
})

app.post("/toggle-mode",(req,res)=>{
botSettings.mode=botSettings.mode==="public"?"private":"public"
res.json(botSettings)
})

app.post("/toggle-antilink",(req,res)=>{
settings.antilink=!settings.antilink
res.json(settings)
})

app.post("/warnlimit",(req,res)=>{
botSettings.warnLimit=parseInt(req.body.limit)||3
res.json(botSettings)
})

app.post("/add-owner",(req,res)=>{
let jid=req.body.number+"@s.whatsapp.net"
if(!owners.includes(jid)) owners.push(jid)
res.json(owners)
})

app.post("/remove-owner",(req,res)=>{
let jid=req.body.number+"@s.whatsapp.net"
owners=owners.filter(o=>o!==jid)
res.json(owners)
})

app.post("/create-command",(req,res)=>{
customCommands[req.body.cmd]=req.body.reply
res.json(customCommands)
})

app.post("/block-user",(req,res)=>{
let jid=req.body.user+"@s.whatsapp.net"
blockedUsers.push(jid)
res.json(blockedUsers)
})

app.listen(PORT,()=>console.log("Dashboard running"))

////////////////////////////////////////////////////
//////////////// WHATSAPP BOT /////////////////////
////////////////////////////////////////////////////

async function startBot(){

const {state,saveCreds}=await useMultiFileAuthState("session")
const {version}=await fetchLatestBaileysVersion()

sock=makeWASocket({
version,
auth:state,
logger:P({level:"silent"}),
printQRInTerminal:false
})

sock.ev.on("creds.update",saveCreds)

sock.ev.on("connection.update",async(update)=>{

const {connection,qr,lastDisconnect}=update

if(qr){
qrcode.generate(qr,{small:true})
qrImage=await QRCode.toDataURL(qr)
}

if(connection==="open"){
botStatus="online"
}

if(connection==="close"){

let reason=lastDisconnect?.error?.output?.statusCode

if(reason!==DisconnectReason.loggedOut){
startBot()
}

}

})

////////////////////////////////////////////////////
//////////////// MESSAGE HANDLER //////////////////
////////////////////////////////////////////////////

sock.ev.on("messages.upsert",async({messages})=>{

let m=messages[0]
if(!m.message) return

stats.messages++

let from=m.key.remoteJid
let sender=m.key.participant||from

if(blockedUsers.includes(sender)) return

let text=
m.message.conversation||
m.message.extendedTextMessage?.text||
""

////////////////////////////////////////////////////
//////////////// ANTI LINK WARN ///////////////////
////////////////////////////////////////////////////

if(settings.antilink && from.endsWith("@g.us") && text.includes("chat.whatsapp.com")){

if(await isAdmin(from,sender)) return

if(!warnings[sender]) warnings[sender]=0

warnings[sender]++

let count=warnings[sender]

await sock.sendMessage(from,{
text:`⚠ Anti-Link Warning ${count}/${botSettings.warnLimit}`,
mentions:[sender]
})

if(count>=botSettings.warnLimit){

await sock.groupParticipantsUpdate(from,[sender],"remove")

warnings[sender]=0

}

}

////////////////////////////////////////////////////
//////////////// COMMAND HANDLER //////////////////
////////////////////////////////////////////////////

if(!text.startsWith(PREFIX)) return

let command=text.slice(1).split(" ")[0].toLowerCase()

stats.commands++

////////////////////////////////////////////////////
//////////////// CUSTOM COMMANDS //////////////////
////////////////////////////////////////////////////

if(customCommands[command]){

return sock.sendMessage(from,{
text:customCommands[command]
})

}

////////////////////////////////////////////////////
//////////////// MENU /////////////////////////////
////////////////////////////////////////////////////

if(command==="menu"){

let menu=`
🌌 Gibborlee BOT

👑 Owner: 2349021540840
⚡ Status: ${botStatus}
📌 Mode: ${botSettings.mode}

📊 Stats
Messages: ${stats.messages}
Commands: ${stats.commands}

📋 General
.menu
.ping

👑 Owner Commands
.vv
.savepp

🛡 Admin
.warn
.hidetags
.antilink
`

await sock.sendMessage(from,{text:menu})

}

////////////////////////////////////////////////////
//////////////// PING /////////////////////////////
////////////////////////////////////////////////////

if(command==="ping"){
sock.sendMessage(from,{text:"🏓 Pong"})
}

////////////////////////////////////////////////////
//////////////// WARN /////////////////////////////
////////////////////////////////////////////////////

if(command==="warn"){

if(!await isAdmin(from,sender)) return

let target=m.message.extendedTextMessage
?.contextInfo?.mentionedJid?.[0]

if(!warnings[target]) warnings[target]=0

warnings[target]++

sock.sendMessage(from,{
text:`⚠ Warn ${warnings[target]}/${botSettings.warnLimit}`
})

}

////////////////////////////////////////////////////
//////////////// HIDETAGS /////////////////////////
////////////////////////////////////////////////////

if(command==="hidetags"){

if(!await isAdmin(from,sender)) return

let meta=await sock.groupMetadata(from)
let members=meta.participants.map(p=>p.id)

let msg=text.replace(".hidetags","")

sock.sendMessage(from,{
text:msg,
mentions:members
})

}

////////////////////////////////////////////////////
//////////////// OWNER COMMANDS ///////////////////
////////////////////////////////////////////////////

if(command==="vv"){

if(!isOwner(sender)) return

let quoted=m.message.extendedTextMessage?.contextInfo?.quotedMessage

if(!quoted) return

let type=Object.keys(quoted)[0]

let stream=await downloadContentFromMessage(
quoted[type],
type.replace("Message","")
)

let buffer=Buffer.from([])

for await(const chunk of stream){
buffer=Buffer.concat([buffer,chunk])
}

await sock.sendMessage(from,{
[type.includes("image")?"image":"video"]:buffer
})

}

if(command==="savepp"){

if(!isOwner(sender)) return

let user=
m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||sender

let url=await sock.profilePictureUrl(user,"image")

await sock.sendMessage(from,{
image:{url},
caption:"Profile picture"
})

}

})

}

startBot()