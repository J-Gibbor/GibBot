import makeWASocket,{
useMultiFileAuthState,
fetchLatestBaileysVersion,
downloadContentFromMessage
} from "@whiskeysockets/baileys"

import express from "express"
import fs from "fs"
import qrcode from "qrcode-terminal"
import P from "pino"

////////////////////////////////////////////////////////

const BOT_NAME="GibborLee Bot"
const OWNER="2349021540840@s.whatsapp.net"
const PREFIX="."
const PORT=process.env.PORT||3000
const DASH_PASS="RoseBella"

////////////////////////////////////////////////////////
//////////////// DATABASE //////////////////////////////
////////////////////////////////////////////////////////

const DB_FILE="./database.json"

let db={
owners:[OWNER],
plugins:{},
warnings:{},
settings:{
warnSystem:true,
antiLink:true,
welcome:true,
goodbye:true,
wordFilter:true
},
mode:"public",
stats:{messages:0,commands:0,start:Date.now()}
}

if(fs.existsSync(DB_FILE)){
db=JSON.parse(fs.readFileSync(DB_FILE))
}

function saveDB(){
fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2))
}

////////////////////////////////////////////////////////
//////////////// MEDIA ARCHIVE /////////////////////////
////////////////////////////////////////////////////////

const MEDIA_DIR="./archive"

if(!fs.existsSync(MEDIA_DIR)){
fs.mkdirSync(MEDIA_DIR)
}

async function saveMedia(type,buffer){

let ext=type.includes("image")?"jpg":"mp4"
let name=Date.now()+"."+ext
let path=MEDIA_DIR+"/"+name

fs.writeFileSync(path,buffer)

return name
}

////////////////////////////////////////////////////////
//////////////// DASHBOARD /////////////////////////////
////////////////////////////////////////////////////////

const app=express()

app.use(express.json())
app.use(express.urlencoded({extended:true}))
app.use("/archive",express.static("./archive"))

let logged=false
let liveMessages=[]

app.get("/",(req,res)=>{

if(!logged){

return res.send(`
<h2>${BOT_NAME} Dashboard</h2>

<form method="POST" action="/login">
<input name="password" type="password"/>
<button>Login</button>
</form>
`)

}

res.send(`

<h1>${BOT_NAME} Dashboard</h1>

<h2>Bot Stats</h2>
<div id="stats"></div>

<h2>Live Messages</h2>
<div id="live"></div>

<h2>Media Archive</h2>

<input id="search">
<button onclick="search()">Search</button>

<div id="media"></div>

<script>

async function loadStats(){

let s=await fetch("/stats").then(r=>r.json())

document.getElementById("stats").innerHTML=
"Messages: "+s.messages+"<br>"+
"Commands: "+s.commands+"<br>"+
"Uptime: "+Math.floor(s.uptime/1000)+"s"

}

async function loadMessages(){

let m=await fetch("/live").then(r=>r.json())

let html=""

m.forEach(x=>{
html+="<div>"+x.sender+": "+x.text+"</div>"
})

document.getElementById("live").innerHTML=html

}

async function search(){

let q=document.getElementById("search").value

let files=await fetch("/search-media?q="+q).then(r=>r.json())

let html=""

files.forEach(f=>{
html+=\`<div><a target="_blank" href="/archive/\${f}">\${f}</a></div>\`
})

document.getElementById("media").innerHTML=html

}

setInterval(loadStats,2000)
setInterval(loadMessages,2000)

</script>

`)

})

app.post("/login",(req,res)=>{

if(req.body.password===DASH_PASS){

logged=true
res.redirect("/")

}else{
res.send("Wrong password")
}

})

app.get("/stats",(req,res)=>{

res.json({
messages:db.stats.messages,
commands:db.stats.commands,
uptime:Date.now()-db.stats.start
})

})

app.get("/live",(req,res)=>res.json(liveMessages))

app.get("/search-media",(req,res)=>{

let q=req.query.q||""

let files=fs.readdirSync("./archive")

res.json(files.filter(f=>f.includes(q)))

})

app.listen(PORT,()=>console.log("Dashboard running"))

////////////////////////////////////////////////////////
//////////////// WHATSAPP BOT //////////////////////////
////////////////////////////////////////////////////////

let sock

async function start(){

const {state,saveCreds}=await useMultiFileAuthState("session")

const {version}=await fetchLatestBaileysVersion()

sock=makeWASocket({
auth:state,
version,
logger:P({level:"silent"})
})

sock.ev.on("creds.update",saveCreds)

sock.ev.on("connection.update",(u)=>{

if(u.qr){
qrcode.generate(u.qr,{small:true})
}

})

////////////////////////////////////////////////////////
//////////////// GROUP EVENTS //////////////////////////
////////////////////////////////////////////////////////

sock.ev.on("group-participants.update",async data=>{

let user=data.participants[0]

if(data.action==="add" && db.settings.welcome){

sock.sendMessage(data.id,{
text:`👋 Welcome @${user.split("@")[0]}`,
mentions:[user]
})

}

if(data.action==="remove" && db.settings.goodbye){

sock.sendMessage(data.id,{
text:`👋 Goodbye @${user.split("@")[0]}`,
mentions:[user]
})

}

})

////////////////////////////////////////////////////////
//////////////// MESSAGE HANDLER ///////////////////////
////////////////////////////////////////////////////////

sock.ev.on("messages.upsert",async({messages})=>{

let m=messages[0]
if(!m.message) return

let from=m.key.remoteJid
let sender=m.key.participant||from

let text=
m.message.conversation||
m.message.extendedTextMessage?.text||
""

db.stats.messages++

liveMessages.unshift({sender,text})
if(liveMessages.length>50) liveMessages.pop()

////////////////////////////////////////////////////////
//////////// HD PROFILE PICTURE ARCHIVE ////////////////
////////////////////////////////////////////////////////

try{

let pp=await sock.profilePictureUrl(sender,"image")

let file="./archive/pp_"+sender.split("@")[0]+".jpg"

if(!fs.existsSync(file)){

let r=await fetch(pp)
let b=Buffer.from(await r.arrayBuffer())

fs.writeFileSync(file,b)

}

}catch{}

////////////////////////////////////////////////////////
//////////// INVISIBLE VIEW ONCE SAVER //////////////////
////////////////////////////////////////////////////////

let viewOnce=
m.message?.viewOnceMessage?.message||
m.message?.viewOnceMessageV2?.message

if(viewOnce){

let type=Object.keys(viewOnce)[0]

let stream=await downloadContentFromMessage(
viewOnce[type],
type.replace("Message","")
)

let buffer=Buffer.from([])

for await(const c of stream){
buffer=Buffer.concat([buffer,c])
}

await saveMedia(type,buffer)

await sock.sendMessage(OWNER,{
[type.includes("image")?"image":"video"]:buffer,
caption:"View once recovered"
})

}

////////////////////////////////////////////////////////
//////////// COMMANDS //////////////////////////////////
////////////////////////////////////////////////////////

if(!text.startsWith(PREFIX)) return

let args=text.slice(1).split(" ")
let command=args.shift().toLowerCase()

db.stats.commands++

////////////////////////////////////////////////////////
//////////////// MENU //////////////////////////////////
////////////////////////////////////////////////////////

if(command==="menu"){

let menu=`
🤖 *${BOT_NAME}*

📌 GENERAL
.menu – show menu
.ping – bot response test

👁 MEDIA
.vv – save view once
.savepp – download profile photo

🛡 MODERATION
.toggle warn
.toggle antilink
.toggle welcome
.toggle goodbye
.toggle wordfilter
`

sock.sendMessage(from,{text:menu})

}

////////////////////////////////////////////////////////
//////////////// PING //////////////////////////////////
////////////////////////////////////////////////////////

if(command==="ping"){
sock.sendMessage(from,{text:"Pong"})
}

////////////////////////////////////////////////////////
//////////////// VIEW ONCE MANUAL //////////////////////
////////////////////////////////////////////////////////

if(command==="vv"){

let quoted=m.message?.extendedTextMessage?.contextInfo?.quotedMessage
if(!quoted) return

let vo=
quoted.viewOnceMessage?.message||
quoted.viewOnceMessageV2?.message

if(!vo) return

let type=Object.keys(vo)[0]

let stream=await downloadContentFromMessage(
vo[type],
type.replace("Message","")
)

let buffer=Buffer.from([])

for await(const c of stream){
buffer=Buffer.concat([buffer,c])
}

await saveMedia(type,buffer)

await sock.sendMessage(OWNER,{
[type.includes("image")?"image":"video"]:buffer
})

}

})

}

start()