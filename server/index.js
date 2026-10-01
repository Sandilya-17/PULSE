require('dotenv').config();
const express=require('express'),http=require('http'),cors=require('cors'),{Server}=require('socket.io'),{Pool}=require('pg'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),multer=require('multer'),path=require('path'),fs=require('fs');
const crypto=require('crypto');
const {S3Client,PutObjectCommand}=require('@aws-sdk/client-s3'),webpush=require('web-push');
const helmet=require('helmet'),rateLimit=require('express-rate-limit');
const PROD=process.env.NODE_ENV==='production';
if(PROD&&!process.env.JWT_SECRET){console.error('FATAL: set JWT_SECRET');process.exit(1)}
const SECRET=process.env.JWT_SECRET||'dev-secret-change-me';
process.on('unhandledRejection',e=>console.error('unhandled',e));
const pool=new Pool({connectionString:process.env.DATABASE_URL||'postgres://pulse:pulse@localhost:5432/pulse',ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:false}:undefined});
const q=(s,p)=>pool.query(s,p).then(r=>r.rows);
fs.mkdirSync('uploads',{recursive:true});
const s3=process.env.S3_BUCKET&&new S3Client({region:process.env.S3_REGION||'auto',endpoint:process.env.S3_ENDPOINT||undefined,forcePathStyle:!!process.env.S3_ENDPOINT,credentials:{accessKeyId:process.env.S3_KEY,secretAccessKey:process.env.S3_SECRET}});
const fname=f=>Date.now()+'-'+Math.random().toString(36).slice(2)+path.extname(f.originalname);
const up=multer({storage:multer.memoryStorage(),limits:{fileSize:15e6}});
const PUSH=process.env.VAPID_PUBLIC&&process.env.VAPID_PRIVATE;
if(PUSH)webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',process.env.VAPID_PUBLIC,process.env.VAPID_PRIVATE);
const ORIGIN=process.env.ORIGIN?process.env.ORIGIN.split(','):true;
const app=express(),srv=http.createServer(app),io=new Server(srv,{cors:{origin:ORIGIN}});
app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:false,crossOriginEmbedderPolicy:false,crossOriginResourcePolicy:false}),cors({origin:ORIGIN}),express.json({limit:'1mb'}));
app.use('/uploads',express.static('uploads',{maxAge:'7d'}));
app.get('/files/:id',(req,res)=>q('select mime,name,data from files where id=$1',[req.params.id]).then(([f])=>{if(!f)return res.sendStatus(404);res.set({'Content-Type':f.mime,'Cache-Control':'public,max-age=31536000,immutable','Content-Disposition':'inline; filename="'+encodeURIComponent(f.name)+'"','X-Content-Type-Options':'nosniff'});res.send(f.data)}).catch(()=>res.sendStatus(404)));
app.get('/healthz',(req,res)=>pool.query('select 1').then(()=>res.send('ok')).catch(()=>res.status(503).send('db down')));
app.use('/api',rateLimit({windowMs:60000,limit:600,standardHeaders:true,legacyHeaders:false}));
app.use(['/api/login','/api/signup'],rateLimit({windowMs:15*60000,limit:30,standardHeaders:true,legacyHeaders:false,message:{error:'Too many attempts, try again later'}}));
const w=f=>(req,res)=>f(req,res).catch(e=>{console.error(e);res.status(500).json({error:'Server error'})});
const sign=u=>jwt.sign({id:u.id,username:u.username,name:u.name},SECRET,{expiresIn:'30d'});
const auth=(req,res,next)=>{try{req.u=jwt.verify((req.headers.authorization||'').slice(7),SECRET);next()}catch{res.status(401).json({error:'Unauthorized'})}};
const isMember=async(c,u)=>(await q('select 1 from members where conv_id=$1 and user_id=$2',[c,u])).length>0;
const memberIds=async c=>(await q('select user_id from members where conv_id=$1',[c])).map(r=>r.user_id);
const online=new Map();

app.post('/api/signup',w(async(req,res)=>{
  const {username='',name='',password=''}=req.body,u=username.toLowerCase().trim();
  if(!/^[a-z0-9_.]{3,20}$/.test(u))return res.status(400).json({error:'Username: 3-20 chars, a-z 0-9 _ .'});
  if(password.length<6)return res.status(400).json({error:'Password min 6 chars'});
  if((await q('select 1 from users where username=$1',[u])).length)return res.status(400).json({error:'Username taken'});
  const [r]=await q('insert into users(username,name,pw) values($1,$2,$3) returning id,username,name,bio',[u,name||u,await bcrypt.hash(password,10)]);
  res.json({token:sign(r),user:r})}));
app.post('/api/login',w(async(req,res)=>{
  const [r]=await q('select * from users where username=$1',[(req.body.username||'').toLowerCase().trim()]);
  if(!r||!await bcrypt.compare(req.body.password||'',r.pw))return res.status(400).json({error:'Wrong username or password'});
  res.json({token:sign(r),user:{id:r.id,username:r.username,name:r.name,bio:r.bio}})}));
app.get('/api/me',auth,w(async(req,res)=>res.json((await q('select id,username,name,bio from users where id=$1',[req.u.id]))[0])));
app.put('/api/me',auth,w(async(req,res)=>res.json((await q('update users set name=$2,bio=$3 where id=$1 returning id,username,name,bio',[req.u.id,(req.body.name||'').slice(0,40)||req.u.name,(req.body.bio||'').slice(0,150)]))[0])));
app.post('/api/upload',auth,up.single('file'),w(async(req,res)=>{
  if(!req.file)return res.status(400).json({error:'No file'});
  if(!s3){const id=crypto.randomUUID();await q('insert into files(id,mime,name,data) values($1,$2,$3,$4)',[id,req.file.mimetype,req.file.originalname,req.file.buffer]);return res.json({url:'/files/'+id})}
  const key=fname(req.file);await s3.send(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,Body:req.file.buffer,ContentType:req.file.mimetype}));
  res.json({url:process.env.S3_PUBLIC_URL.replace(/\/$/,'')+'/'+key})}));
app.put('/api/me/key',auth,w(async(req,res)=>{await q('update users set pubkey=$2 where id=$1',[req.u.id,req.body.pubkey]);res.json({ok:1})}));
// TURN: ephemeral credentials (coturn use-auth-secret)
app.get('/api/ice',auth,(req,res)=>{const l=[{urls:'stun:stun.l.google.com:19302'}];
  if(process.env.TURN_URL&&process.env.TURN_SECRET){const user=(Math.floor(Date.now()/1000)+86400)+':'+req.u.id;
    l.push({urls:process.env.TURN_URL.split(','),username:user,credential:crypto.createHmac('sha1',process.env.TURN_SECRET).update(user).digest('base64')})}
  if(process.env.TURN_URL&&process.env.TURN_USERNAME)l.push({urls:process.env.TURN_URL.split(','),username:process.env.TURN_USERNAME,credential:process.env.TURN_CREDENTIAL});
  res.json(l)});
// Web Push
app.get('/api/push/key',auth,(req,res)=>res.json({key:PUSH?process.env.VAPID_PUBLIC:null}));
app.post('/api/push/subscribe',auth,w(async(req,res)=>{const sub=req.body.sub;await q('insert into push_subs(endpoint,user_id,sub) values($1,$2,$3) on conflict(endpoint) do update set user_id=$2,sub=$3',[sub.endpoint,req.u.id,JSON.stringify(sub)]);res.json({ok:1})}));
const push=async(uid,payload)=>{if(!PUSH||online.has(uid))return;for(const r of await q('select endpoint,sub from push_subs where user_id=$1',[uid])){
  try{await webpush.sendNotification(JSON.parse(r.sub),JSON.stringify(payload))}catch(e){if([404,410].includes(e.statusCode))await q('delete from push_subs where endpoint=$1',[r.endpoint])}}};
const rooms=new Map(); // convId -> Map(userId -> name): mesh group/1:1 calls

app.get('/api/users',auth,w(async(req,res)=>res.json(await q(`select id,username,name,bio,exists(select 1 from follows where follower=$1 and following=users.id) following from users where id<>$1 and (username ilike $2 or name ilike $2) limit 30`,[req.u.id,'%'+(req.query.q||'')+'%']))));
app.post('/api/follow/:id',auth,w(async(req,res)=>{
  const d=await q('delete from follows where follower=$1 and following=$2 returning 1',[req.u.id,req.params.id]);
  if(!d.length){await q('insert into follows values($1,$2)',[req.u.id,req.params.id]);io.to('user:'+req.params.id).emit('notify','@'+req.u.username+' started following you')}
  res.json({following:!d.length})}));

app.get('/api/conversations',auth,w(async(req,res)=>res.json(await q(`select c.id,c.is_group,c.title,
 (select json_agg(json_build_object('id',u.id,'username',u.username,'name',u.name,'pubkey',u.pubkey)) from members m2 join users u on u.id=m2.user_id where m2.conv_id=c.id and u.id<>$1) others,
 (select row_to_json(m) from (select id,body,media,sender_id,created from messages where conv_id=c.id order by id desc limit 1) m) last,
 (select count(*) from messages x where x.conv_id=c.id and x.sender_id<>$1 and x.id>me.last_read)::int unread
 from conversations c join members me on me.conv_id=c.id and me.user_id=$1 order by coalesce((select max(id) from messages where conv_id=c.id),0) desc`,[req.u.id]))));
app.post('/api/conversations',auth,w(async(req,res)=>{
  const o=+req.body.user;
  let [c]=await q(`select c.id from conversations c where not is_group and exists(select 1 from members where conv_id=c.id and user_id=$1) and exists(select 1 from members where conv_id=c.id and user_id=$2)`,[req.u.id,o]);
  if(!c){[c]=await q('insert into conversations default values returning id');await q('insert into members(conv_id,user_id) values($1,$2),($1,$3)',[c.id,req.u.id,o])}
  res.json({id:c.id})}));
app.post('/api/groups',auth,w(async(req,res)=>{
  const names=(req.body.usernames||[]).map(s=>s.trim().toLowerCase()),us=await q('select id from users where username=any($1)',[names]);
  if(!us.length)return res.status(400).json({error:'No valid usernames'});
  const [c]=await q('insert into conversations(is_group,title) values(true,$1) returning id',[req.body.title||'Group']);
  for(const id of new Set([req.u.id,...us.map(u=>u.id)]))await q('insert into members(conv_id,user_id) values($1,$2)',[c.id,id]);
  res.json({id:c.id})}));
app.get('/api/conversations/:id/messages',auth,w(async(req,res)=>{
  if(!await isMember(req.params.id,req.u.id))return res.sendStatus(403);
  const messages=await q('select m.id,m.conv_id conv,m.sender_id,u.username sender,m.body,m.media,m.created from messages m join users u on u.id=m.sender_id where conv_id=$1 order by m.id desc limit 200',[req.params.id]);
  const [{r}]=await q('select coalesce(max(last_read),0) r from members where conv_id=$1 and user_id<>$2',[req.params.id,req.u.id]);
  res.json({messages:messages.reverse(),otherRead:r})}));

app.get('/api/feed',auth,w(async(req,res)=>res.json(await q(`select p.id,p.caption,p.image,p.created,u.username,(select count(*) from likes where post_id=p.id)::int likes,exists(select 1 from likes where post_id=p.id and user_id=$1) liked,
 coalesce((select json_agg(json_build_object('by',cu.username,'text',c.body) order by c.id) from comments c join users cu on cu.id=c.user_id where c.post_id=p.id),'[]') comments
 from posts p join users u on u.id=p.user_id where $2 or p.user_id=$1 or p.user_id in(select following from follows where follower=$1) order by p.id desc limit 50`,[req.u.id,!!req.query.all]))));
app.post('/api/posts',auth,w(async(req,res)=>{await q('insert into posts(user_id,caption,image) values($1,$2,$3)',[req.u.id,(req.body.caption||'').slice(0,500),req.body.image||null]);res.json({ok:1})}));
app.post('/api/posts/:id/like',auth,w(async(req,res)=>{const d=await q('delete from likes where post_id=$1 and user_id=$2 returning 1',[req.params.id,req.u.id]);if(!d.length)await q('insert into likes values($1,$2)',[req.params.id,req.u.id]);res.json({ok:1})}));
app.post('/api/posts/:id/comment',auth,w(async(req,res)=>{await q('insert into comments(post_id,user_id,body) values($1,$2,$3)',[req.params.id,req.u.id,(req.body.text||'').slice(0,200)]);res.json({ok:1})}));
app.get('/api/stories',auth,w(async(req,res)=>res.json(await q(`select s.id,s.media,u.username from stories s join users u on u.id=s.user_id where s.created>now()-interval '24 hours' and (s.user_id=$1 or s.user_id in(select following from follows where follower=$1)) order by s.id desc`,[req.u.id]))));
app.post('/api/stories',auth,w(async(req,res)=>{await q('insert into stories(user_id,media) values($1,$2)',[req.u.id,req.body.media]);res.json({ok:1})}));

const dist=path.join(__dirname,'../client/dist');
if(fs.existsSync(dist)){app.use(express.static(dist));app.get('*',(req,res,next)=>/^\/(api|socket.io|uploads|files)/.test(req.path)?next():res.sendFile(path.join(dist,'index.html')))}
io.use((s,next)=>{try{s.u=jwt.verify(s.handshake.auth.token,SECRET);next()}catch{next(new Error('auth'))}});
io.on('connection',s=>{
  const {id}=s.u;s.join('user:'+id);online.set(id,(online.get(id)||0)+1);
  s.emit('online',[...online.keys()]);io.emit('presence',{id,on:true});
  s.on('message',async d=>{try{
    if(!await isMember(d.conv,id)||(!d.body&&!d.media))return;
    const [m]=await q('insert into messages(conv_id,sender_id,body,media) values($1,$2,$3,$4) returning id,conv_id conv,sender_id,body,media,created',[d.conv,id,String(d.body||'').slice(0,2000),d.media||null]);
    m.sender=s.u.username;(await memberIds(d.conv)).forEach(u=>{io.to('user:'+u).emit('message',m);if(u!==id)push(u,{title:s.u.name,body:'New message',conv:d.conv})})}catch(e){console.error(e)}});
  s.on('read',async({conv})=>{try{
    const [r]=await q('update members set last_read=(select coalesce(max(id),0) from messages where conv_id=$1) where conv_id=$1 and user_id=$2 returning last_read',[conv,id]);
    if(r)(await memberIds(conv)).forEach(u=>io.to('user:'+u).emit('read',{conv,uid:id,upto:r.last_read}))}catch(e){console.error(e)}});
  s.on('typing',async({conv})=>{(await memberIds(conv)).filter(u=>u!==id).forEach(u=>io.to('user:'+u).emit('typing',{conv}))});
  s.on('gcall:join',async({conv,video},ack)=>{try{
    if(!await isMember(conv,id))return;let r=rooms.get(conv);if(!r)rooms.set(conv,r=new Map());
    if(r.size>=6)return ack({error:'full'});
    const peers=[...r].map(([uid,name])=>({id:uid,name}));
    if(!r.size)(await memberIds(conv)).filter(u=>u!==id).forEach(u=>{io.to('user:'+u).emit('gcall:ring',{conv,from:id,name:s.u.name,video});push(u,{title:s.u.name+' is calling',body:'Tap to answer',conv})});
    r.set(id,s.u.name);s.callConv=conv;ack({peers})}catch(e){console.error(e)}});
  s.on('gcall:signal',({to,conv,data})=>io.to('user:'+to).emit('gcall:signal',{from:id,name:s.u.name,conv,data}));
  const leave=async()=>{const c=s.callConv;if(!c)return;s.callConv=null;const r=rooms.get(c);if(!r)return;r.delete(id);r.forEach((_,u)=>io.to('user:'+u).emit('gcall:left',{conv:c,id}));
    if(!r.size){rooms.delete(c);(await memberIds(c)).forEach(u=>io.to('user:'+u).emit('gcall:ring-cancel',{conv:c}))}};
  s.on('gcall:leave',leave);
  s.on('disconnect',()=>{leave();const n=(online.get(id)||1)-1;if(n)online.set(id,n);else{online.delete(id);io.emit('presence',{id,on:false})}});
});
pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8')).then(()=>srv.listen(process.env.PORT||4000,()=>console.log('API on :'+(process.env.PORT||4000)))).catch(e=>{console.error('DB error - is Postgres running? (docker compose up -d)',e.message);process.exit(1)});
