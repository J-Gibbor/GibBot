import makeWASocket, {
useMultiFileAuthState,
downloadContentFromMessage
} from "@whiskeysockets/baileys"

import express from "express"
import P from "pino"
import QRCode from "qrcode"

const OWNER="2349021540840@s.whatsapp.net"
const PREFIX="."
const PASSWORD="RoseBella"
const PORT=process.env.PORT || 3000

let logged=false
let qrData=null
let botStatus="offline"

let admins=[OWNER]

let customCommands={}

let settings={
antilink:true,
autoreply:true
}

const autoReplies={
hello:["Hello 👋","Hi there 😄","Hey!"],
hi:["Hello 👋","Hi!","Hey 😄"],
thanks:["You're welcome 😊","No problem 👍"],
lol:["😂","🤣"],
good:["Nice 👍","Great!"],
morning:["Good morning ☀️"],
night:["Good night 🌙"],
bye:["Bye 👋","See you later"],
bot:["Yes? 🤖","How can I help?"]
}

const app=express()
app.use(express.json())
app.use(express.urlencoded({extended:true}))

// LOGIN PAGE
app.get("/",(req,res)=>{

if(!logged){
return res.send(`
<h2>Gibborlee Bot Login</h2>
<form method="POST" action="/login">
<input type="password" name="password"/>
<button>Login</button>
</form>
`)
}

res.send(`
<h1>Gibborlee Bot Dashboard</h1>

<p>Status: ${botStatus}</p>

<h3>QR Login</h3>
<img src="${qrData||""}" width="300"/>

<hr>

<h2>Create Command</h2>

<input id="name" placeholder="command"/>
<input id="reply" placeholder="reply"/>
<button onclick="create()">Create</button>

<h2>Commands</h2>
<div id="cmds"></div>

<script>

async function load(){

let r=await fetch("/commands")
let d=await r.json()

let html=""

for(let c in d){

html+=\`
<div>
<b>.\${c}</b> - \${d[c].reply}
<button onclick="del('\${c}')">Delete</button>
</div>
\`
}

document.getElementById("cmds").innerHTML=html

}

async function create(){

let name=document.getElementById("name").value
let reply=document.getElementById("reply").value

await fetch("/create",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({name,reply})
})

load()

}

async function del(name){

await fetch("/delete",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({name})
})

load()

}

load()

</script>
`)
})

// LOGIN
app.post("/login",(req,res)=>{

if(req.body.password===PASSWORD){
logged=true
res.redirect("/")
}else{
res.send("Wrong password")
}

})

// COMMAND LIST
app.get("/commands",(req,res)=>{

if(!logged) return res.json({})

res.json(customCommands)

})

// CREATE COMMAND
app.post("/create",(req,res)=>{

let {name,reply}=req.body

name=name.toLowerCase()

customCommands[name]={
reply,
enabled:true,
adminOnly:false
}

res.json({status:"ok"})

})

// DELETE COMMAND
app.post("/delete",(req,res)=>{

delete customCommands[req.body.name]

res.json({status:"deleted"})

})

app.listen(PORT,()=>{

console.log("Dashboard running")

})

// BOT
async function start(){

const {state,saveCreds}=
await useMultiFileAuthState("session")

const sock=makeWASocket({
logger:P({level:"silent"}),
auth:state
})

sock.ev.on("creds.update",saveCreds)

sock.ev.on("connection.update",async(update)=>{

const {connection,qr}=update

if(qr){
qrData=await QRCode.toDataURL(qr)
}

if(connection==="open"){
botStatus="online"
console.log("Bot connected")
}

})

sock.ev.on("messages.upsert",async({messages})=>{

let m=messages[0]

if(!m.message) return

let from=m.key.remoteJid
let sender=m.key.participant||from

let text=
m.message.conversation ||
m.message.extendedTextMessage?.text ||
""

let command=
text.startsWith(PREFIX)
?text.slice(1).split(" ")[0].toLowerCase()
:null

// AUTO REPLY
if(settings.autoreply){

let t=text.toLowerCase()

if(autoReplies[t]){

let replies=autoReplies[t]

let reply=
replies[Math.floor(Math.random()*replies.length)]

await sock.sendMessage(from,{text:reply})

}

}

// ANTI LINK
if(settings.antilink && text.includes("chat.whatsapp.com")){

await sock.sendMessage(from,{
text:"Links not allowed 🚫"
})

}

// CUSTOM COMMANDS
if(customCommands[command]){

let cmd=customCommands[command]

if(!cmd.enabled) return

if(cmd.adminOnly && !admins.includes(sender))
return

await sock.sendMessage(from,{
text:cmd.reply
})

return

}

// MENU
if(command==="menu"){

await sock.sendMessage(from,{
text:`
Gibborlee BOT

.menu
.ping
.vv
.savepp
`
})

}

// PING
if(command==="ping"){

await sock.sendMessage(from,{
text:"Pong 🏓"
})

}

// VIEW ONCE SAVER
if(command==="vv"){

let quoted=
m.message?.extendedTextMessage?.contextInfo
?.quotedMessage

if(!quoted) return

let type=Object.keys(quoted)[0]

let stream=
await downloadContentFromMessage(
quoted[type],
type==="imageMessage"?"image":"video"
)

let buffer=Buffer.from([])

for await(const chunk of stream){
buffer=Buffer.concat([buffer,chunk])
}

await sock.sendMessage(from,{
[type==="imageMessage"?"image":"video"]:buffer
})

}

// SAVE PROFILE PIC
if(command==="savepp"){

let url=
await sock.profilePictureUrl(sender,"image")

await sock.sendMessage(from,{
image:{url},
caption:"Profile picture"
})

}

})

}

start()