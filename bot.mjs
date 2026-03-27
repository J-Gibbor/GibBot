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
import QRCode from "qrcode"

/////////////////////////////////////////////////

const BOT_NAME="GibborLee Bot"
const PREFIX="."
const PORT=process.env.PORT||3000
const DASH_PASS="RoseBella"

/////////////////////////////////////////////////
//////////////// DATABASE ///////////////////////

const DB_FILE="./database.json"

let db={
owners:["2349021540840@s.whatsapp.net"],
warnings:{},
settings:{
warn:true,
antilink:true,
welcome:true,
goodbye:true
},
stats:{messages:0,commands:0,start:Date.now()}
}

if(fs.existsSync(DB_FILE)){
db=JSON.parse(fs.readFileSync(DB_FILE))
}

function saveDB(){
fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2))
}

/////////////////////////////////////////////////
//////////////// FOLDERS ////////////////////////

if(!fs.existsSync("./session")) fs.mkdirSync("./session")
if(!fs.existsSync("./archive")) fs.mkdirSync("./archive")

/////////////////////////////////////////////////
//////////////// ERROR LOGGER ///////////////////

function logError(e){
let time=new Date().toISOString()
fs.appendFileSync("error.log",`[${time}] ${e}\n`)
console.error(e)
}

process.on("uncaughtException",logError)
process.on("unhandledRejection",logError)

/////////////////////////////////////////////////
//////////////// HELPERS ////////////////////////

function isOwner(user){
return db.owners.includes(user)
}

/////////////////////////////////////////////////
//////////////// DASHBOARD //////////////////////

const app=express()

app.use(express.json())
app.use(express.urlencoded({extended:true}))
app.use("/archive",express.static("./archive"))

let logged=false
let dashboardQR=""
let liveMessages=[]

app.get("/",async(req,res)=>{

if(!logged){

return res.send(`
<h2>${BOT_NAME} Dashboard</h2>

<form method="POST" action="/login">
<input name="password" type="password"/>
<button>Login</button>
</form>
`)
}

let qrImg=""

if(dashboardQR){
qrImg=await QRCode.toDataURL(dashboardQR)
}

res.send(`

<h1>${BOT_NAME} Dashboard</h1>

<h2>QR Login</h2>
${dashboardQR?`<img src="${qrImg}" width="250"/>`:"Connected"}

<h2>Bot Stats</h2>
<div id="stats"></div>

<h2>Owners</h2>

<input id="ownerNum" placeholder="234XXXXXXXXX">

<button onclick="addOwner()">Add</button>
<button onclick="removeOwner()">Remove</button>

<div id="owners"></div>

<h2>Media Archive</h2>

<input id="search">
<button onclick="search()">Search</button>

<div id="media"></div>

<h2>Live Messages</h2>

<div id="live"></div>

<script>

async function loadStats(){

let s=await fetch("/stats").then(r=>r.json())

document.getElementById("stats").innerHTML=
"Messages: "+s.messages+"<br>"+
"Commands: "+s.commands

}

async function loadOwners(){

let o=await fetch("/owners").then(r=>r.json())

let html=""

o.forEach(x=>{
html+="<div>"+x+"</div>"
})

document.getElementById("owners").innerHTML=html

}

async function addOwner(){

let num=document.getElementById("ownerNum").value

await fetch("/add-owner",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({number:num})
})

loadOwners()

}

async function removeOwner(){

let num=document.getElementById("ownerNum").value

await fetch("/remove-owner",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({number:num})
})

loadOwners()

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
setInterval(loadOwners,2000)
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
res.json(db.stats)
})

app.get("/live",(req,res)=>{
res.json(liveMessages)
})

app.get("/owners",(req,res)=>{
res.json(db.owners)
})

app.post("/add-owner",(req,res)=>{

let num=req.body.number

let jid=num+"@s.whatsapp.net"

if(!db.owners.includes(jid)){
db.owners.push(jid)
saveDB()
}

res.send("added")

})

app.post("/remove-owner",(req,res)=>{

let num=req.body.number

let jid=num+"@s.whatsapp.net"

db.owners=db.owners.filter(x=>x!==jid)

saveDB()

res.send("removed")

})

app.get("/search-media",(req,res)=>{

let q=req.query.q||""

let files=fs.readdirSync("./archive")

res.json(files.filter(f=>f.includes(q)))

})

app.listen(PORT,()=>console.log("Dashboard running"))

/////////////////////////////////////////////////
//////////////// WHATSAPP BOT ///////////////////

let sock

async function startBot(){

try{

const {state,saveCreds}=await useMultiFileAuthState("session")

const {version}=await fetchLatestBaileysVersion()

sock=makeWASocket({

auth:state,
version,
printQRInTerminal:true,
logger:P({level:"silent"}),
browser:[BOT_NAME,"Chrome","1.0"]

})

sock.ev.on("creds.update",saveCreds)

sock.ev.on("connection.update",async(update)=>{

let {connection,lastDisconnect,qr}=update

if(qr){
dashboardQR=qr
qrcode.generate(qr,{small:true})
}

if(connection==="close"){

let reason=lastDisconnect?.error?.output?.statusCode

if(reason!==DisconnectReason.loggedOut){
startBot()
}

}

if(connection==="open"){
dashboardQR=""
console.log("Bot connected")
}

})

/////////////////////////////////////////////////
//////////////// MESSAGE HANDLER ////////////////

sock.ev.on("messages.upsert",async({messages})=>{

try{

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
if(liveMessages.length>40) liveMessages.pop()

/////////////////////////////////////////////////
////////// AUTO VIEW ONCE SAVER //////////////////

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

for await(const chunk of stream){
buffer=Buffer.concat([buffer,chunk])
}

let ext=type.includes("image")?"jpg":"mp4"
let name=Date.now()+"."+ext

fs.writeFileSync("./archive/"+name,buffer)

let owner=db.owners[0]

await sock.sendMessage(owner,{
[type.includes("image")?"image":"video"]:buffer,
caption:"View once saved"
})

}

/////////////////////////////////////////////////
//////////////// COMMANDS ///////////////////////

if(!text.startsWith(PREFIX)) return

let args=text.slice(1).split(" ")
let command=args.shift().toLowerCase()

db.stats.commands++

/////////////////////////////////////////////////
//////////////// MENU ///////////////////////////

if(command==="menu"){

let menu=`

🤖 ${BOT_NAME}

GENERAL
.menu
.ping

MEDIA
.vv

MODERATION
.tagall
.hidetags

`

sock.sendMessage(from,{text:menu})

}

/////////////////////////////////////////////////

if(command==="ping"){
sock.sendMessage(from,{text:"pong"})
}

/////////////////////////////////////////////////
//////////////// TAGALL /////////////////////////

if(command==="tagall" && from.endsWith("@g.us")){

let meta=await sock.groupMetadata(from)

let text="📢 Tagging all\n\n"

let mentions=[]

meta.participants.forEach(p=>{
mentions.push(p.id)
text+="@"+p.id.split("@")[0]+"\n"
})

sock.sendMessage(from,{text,mentions})

}

/////////////////////////////////////////////////
//////////////// HIDETAGS ///////////////////////

if(command==="hidetags" && from.endsWith("@g.us")){

let meta=await sock.groupMetadata(from)

let mentions=meta.participants.map(p=>p.id)

let msg=args.join(" ")

sock.sendMessage(from,{
text:msg||"",
mentions
})

}

/////////////////////////////////////////////////
//////////////// VV /////////////////////////////

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

sock.sendMessage(from,{
[type.includes("image")?"image":"video"]:buffer
})

}

}catch(e){
logError(e)
}

})

}catch(e){

logError(e)
setTimeout(startBot,5000)

}

}

startBot()