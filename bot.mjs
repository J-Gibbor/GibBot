import makeWASocket,{
useMultiFileAuthState,
fetchLatestBaileysVersion,
DisconnectReason,
downloadContentFromMessage
} from "@whiskeysockets/baileys"

import express from "express"
import fs from "fs"
import P from "pino"
import qrcode from "qrcode-terminal"

const BOT_NAME="GibborLee Bot"
const PREFIX="."
const DASH_PASSWORD="RoseBella"
const PORT=process.env.PORT || 3000

let sock

////////////////////////////////////////////////////
//////////////// DATABASE //////////////////////////
////////////////////////////////////////////////////

const DB_FILE="./database.json"

let db={
owners:["2349021540840@s.whatsapp.net"],
plugins:{},
warnings:{},
settings:{
antilink:true,
welcome:true,
goodbye:true,
autoreply:true
},
analytics:{groups:{}}
}

if(fs.existsSync(DB_FILE)){
db=JSON.parse(fs.readFileSync(DB_FILE))
}

function saveDB(){
fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2))
}

////////////////////////////////////////////////////
//////////////// EXPRESS DASHBOARD //////////////////
////////////////////////////////////////////////////

const app=express()
app.use(express.json())

let logged=false

app.get("/",(req,res)=>{

if(!logged){
return res.send(`
<h2>${BOT_NAME} Login</h2>
<form method="POST" action="/login">
<input type="password" name="password"/>
<button>Login</button>
</form>
`)
}

res.send(`
<h1>🤖 ${BOT_NAME} Dashboard</h1>

<h3>Plugins</h3>
<div id="plugins"></div>

<input id="cmd">
<input id="reply">

<select id="perm">
<option value="user">User</option>
<option value="admin">Admin</option>
<option value="owner">Owner</option>
</select>

<button onclick="add()">Add Plugin</button>

<script>

async function load(){

let data=await fetch("/plugins").then(r=>r.json())

let html=""

for(let p in data){

html+=\`
<div>
.\${p} - \${data[p].permission}
<button onclick="del('\${p}')">Delete</button>
</div>
\`

}

document.getElementById("plugins").innerHTML=html

}

async function add(){

let name=document.getElementById("cmd").value
let response=document.getElementById("reply").value
let permission=document.getElementById("perm").value

await fetch("/install-plugin",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({name,response,permission})
})

load()

}

async function del(name){

await fetch("/delete-plugin",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({name})
})

load()

}

setInterval(load,3000)

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

app.get("/plugins",(req,res)=>res.json(db.plugins))

app.post("/install-plugin",(req,res)=>{

let {name,response,permission}=req.body

db.plugins[name]={
response,
permission,
enabled:true
}

saveDB()

res.json({ok:true})

})

app.post("/delete-plugin",(req,res)=>{

delete db.plugins[req.body.name]

saveDB()

res.json({ok:true})

})

app.listen(PORT,()=>console.log("Dashboard running"))

////////////////////////////////////////////////////
//////////////// WHATSAPP BOT //////////////////////
////////////////////////////////////////////////////

function isOwner(id){
return db.owners.includes(id)
}

async function isAdmin(group,user){

let meta=await sock.groupMetadata(group)

let admins=meta.participants
.filter(p=>p.admin)
.map(p=>p.id)

return admins.includes(user)

}

////////////////////////////////////////////////////
//////////////// AUTO REPLIES //////////////////////
////////////////////////////////////////////////////

const autoReplies={
hello:["Hello 👋","Hi there!","Hey!","Greetings 😊"],
hi:["Hi 👋","Hello!","Hey there!"],
bot:["Yes I'm here 🤖","Bot active","Ready!"],
thanks:["You're welcome","No problem","Glad to help"],
bye:["Goodbye 👋","See you later","Take care"]
}

function random(arr){
return arr[Math.floor(Math.random()*arr.length)]
}

////////////////////////////////////////////////////
//////////////// START BOT /////////////////////////
////////////////////////////////////////////////////

async function start(){

const {state,saveCreds}=await useMultiFileAuthState("session")

const {version}=await fetchLatestBaileysVersion()

sock=makeWASocket({
version,
auth:state,
logger:P({level:"silent"})
})

sock.ev.on("creds.update",saveCreds)

sock.ev.on("connection.update",(update)=>{

let {connection,qr,lastDisconnect}=update

if(qr){
qrcode.generate(qr,{small:true})
}

if(connection==="close"){

if(lastDisconnect?.error?.output?.statusCode!==DisconnectReason.loggedOut){
start()
}

}

})

////////////////////////////////////////////////////
//////////////// GROUP EVENTS //////////////////////
////////////////////////////////////////////////////

sock.ev.on("group-participants.update",async(data)=>{

let meta=await sock.groupMetadata(data.id)

for(let user of data.participants){

let tag="@"+user.split("@")[0]

if(data.action==="add" && db.settings.welcome){

await sock.sendMessage(data.id,{
text:`👋 Welcome ${tag} to *${meta.subject}*`,
mentions:[user]
})

}

if(data.action==="remove" && db.settings.goodbye){

await sock.sendMessage(data.id,{
text:`👋 Goodbye ${tag}`,
mentions:[user]
})

}

}

})

////////////////////////////////////////////////////
//////////////// MESSAGE HANDLER ///////////////////
////////////////////////////////////////////////////

sock.ev.on("messages.upsert",async({messages})=>{

let m=messages[0]

if(!m.message) return

let from=m.key.remoteJid
let sender=m.key.participant||from

let text=
m.message.conversation||
m.message.extendedTextMessage?.text||
""

////////////////////////////////////////////////////
//// AUTO REPLY
////////////////////////////////////////////////////

if(db.settings.autoreply){

let lower=text.toLowerCase()

for(let k in autoReplies){

if(lower.includes(k)){

sock.sendMessage(from,{text:random(autoReplies[k])})

}

}

}

////////////////////////////////////////////////////
//// COMMANDS
////////////////////////////////////////////////////

if(!text.startsWith(PREFIX)) return

let command=text.slice(1).split(" ")[0]

////////////////////////////////////////////////////
//// MENU
////////////////////////////////////////////////////

if(command==="menu"){

sock.sendMessage(from,{
text:`
🤖 *${BOT_NAME}*

📌 General
.menu
.ping

👁 Media
.vv
.savepp
.status

🛡 Admin
.warn
.antilink

⚙ Plugins
Install commands from dashboard
`
})

}

////////////////////////////////////////////////////
//// PING
////////////////////////////////////////////////////

if(command==="ping"){
sock.sendMessage(from,{text:"🏓 Pong"})
}

////////////////////////////////////////////////////
//// VIEW ONCE
////////////////////////////////////////////////////

if(command==="vv"){

let quoted=m.message?.extendedTextMessage?.contextInfo?.quotedMessage

if(!quoted) return

let viewOnce=quoted.viewOnceMessage?.message

if(!viewOnce) return

let type=Object.keys(viewOnce)[0]

let stream=await downloadContentFromMessage(
viewOnce[type],
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

////////////////////////////////////////////////////
//// SAVE PROFILE PIC
////////////////////////////////////////////////////

if(command==="savepp"){

let user=
m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||sender

let url=await sock.profilePictureUrl(user,"image")

sock.sendMessage(from,{
image:{url},
caption:"Profile picture"
})

}

////////////////////////////////////////////////////
//// PLUGIN COMMANDS
////////////////////////////////////////////////////

if(db.plugins[command]){

let p=db.plugins[command]

if(!p.enabled) return

if(p.permission==="owner" && !isOwner(sender)){
return sock.sendMessage(from,{text:"Owner only"})
}

if(p.permission==="admin"){

let admin=await isAdmin(from,sender)

if(!admin){
return sock.sendMessage(from,{text:"Admin only"})
}

}

sock.sendMessage(from,{text:p.response})

}

})

}

start()