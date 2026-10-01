import {useEffect,useRef,useState,useCallback} from 'react';import {io} from 'socket.io-client';
const tk=()=>localStorage.t,BRAND=import.meta.env.VITE_BRAND||'Pulse',SUPPORT=import.meta.env.VITE_SUPPORT||'support@example.com';
async function api(p,m='GET',b){const r=await fetch('/api/'+p,{method:m,headers:{'Content-Type':'application/json',Authorization:'Bearer '+tk()},body:b?JSON.stringify(b):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Error');return j}
async function upload(file){const f=new FormData();f.append('file',file);const r=await fetch('/api/upload',{method:'POST',headers:{Authorization:'Bearer '+tk()},body:f});return (await r.json()).url}
const Av=({n,on})=><div className={'av '+(on?'on':'')}>{(n||'?')[0].toUpperCase()}</div>;
const idb=()=>new Promise((res,rej)=>{const r=indexedDB.open('pulse',1);r.onupgradeneeded=()=>r.result.createObjectStore('k');r.onsuccess=()=>res(r.result);r.onerror=rej});
const idbGet=async k=>{const d=await idb();return new Promise(r=>{const q=d.transaction('k').objectStore('k').get(k);q.onsuccess=()=>r(q.result)})};
const idbSet=async(k,v)=>{const d=await idb();return new Promise(r=>{const t=d.transaction('k','readwrite');t.objectStore('k').put(v,k);t.oncomplete=r})};
async function ensureKeys(uid){let kp=await idbGet('kp'+uid);if(!kp){kp=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveKey']);await idbSet('kp'+uid,kp)}
  await api('me/key','PUT',{pubkey:JSON.stringify(await crypto.subtle.exportKey('jwk',kp.publicKey))});return kp}
const sk=async(kp,pub)=>crypto.subtle.deriveKey({name:'ECDH',public:await crypto.subtle.importKey('jwk',JSON.parse(pub),{name:'ECDH',namedCurve:'P-256'},false,[])},kp.privateKey,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))),unb=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function enc(kp,pub,t){const iv=crypto.getRandomValues(new Uint8Array(12)),c=await crypto.subtle.encrypt({name:'AES-GCM',iv},await sk(kp,pub),new TextEncoder().encode(t));return 'e2e:'+b64(iv)+'.'+b64(c)}
async function dec(kp,pub,t){try{const [i,c]=t.slice(4).split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb(i)},await sk(kp,pub),unb(c)))}catch{return "🔒 Can't decrypt on this device"}}
const u8=k=>Uint8Array.from(atob((k+'='.repeat((4-k.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function enablePush(){const {key}=await api('push/key');if(!key)return alert('Push is not configured on the server (set VAPID keys)');
  if(await Notification.requestPermission()!=='granted')return;const reg=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;
  await api('push/subscribe','POST',{sub:await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:u8(key)})});alert('Notifications enabled')}
const preview=b=>!b?'📎 Media':b.startsWith('e2e:')?'🔒 Encrypted message':b;
const isImg=u=>/\.(png|jpe?g|gif|webp)$/i.test(u||'');

export default function App(){
  const [me,setMe]=useState(null),[ready,setReady]=useState(!tk());
  useEffect(()=>{tk()&&api('me').then(setMe).catch(()=>localStorage.removeItem('t')).finally(()=>setReady(true))},[]);
  if(!ready)return null;
  return me?<Main me={me} setMe={setMe}/>:<Auth onAuth={setMe}/>;
}
function Auth({onAuth}){
  const [f,setF]=useState({}),[err,setErr]=useState(''),[legal,setLegal]=useState(null);
  const go=async k=>{try{const r=await api(k,'POST',f);localStorage.t=r.token;onAuth(r.user)}catch(e){setErr(e.message)}};
  return <div className="auth"><h1>{BRAND}</h1><div className="m">Secure messaging, calls and sharing for teams and friends.</div>
    {['username','name','password'].map(k=><input key={k} type={k==='password'?'password':'text'} placeholder={k==='name'?'display name (sign up)':k} autoCapitalize="off" onChange={e=>setF({...f,[k]:e.target.value})}/>)}
    <button onClick={()=>go('login')}>Log in</button><button className="s" onClick={()=>go('signup')}>Create account</button><div className="err">{err}</div><div className="m">By continuing you agree to the <a href="#" onClick={e=>{e.preventDefault();setLegal('terms')}}>Terms</a> and <a href="#" onClick={e=>{e.preventDefault();setLegal('privacy')}}>Privacy Policy</a>.</div>{legal&&<Legal k={legal} close={()=>setLegal(null)}/>}</div>;
}
const LEGAL={terms:['Terms of Use','Use the service lawfully and respectfully. No harassment, spam, illegal content or abuse. We may suspend accounts that break these rules. The service is provided "as is" without warranty. Contact: '],privacy:['Privacy Policy','We store your username, display name, bio, messages, posts and uploads to run the service. 1:1 message text is end-to-end encrypted and unreadable to us. Group messages, attachments and metadata are not. We do not sell your data. Contact us to request deletion. Contact: ']};
function Legal({k,close}){return <div className="view" onClick={close}><div className="post" style={{maxWidth:420,padding:16}}><h3>{LEGAL[k][0]}</h3><p>{LEGAL[k][1]}{SUPPORT}</p><button onClick={close}>Close</button></div></div>}
function useCall(sock){
  const [st,setSt]=useState(null),[streams,setStreams]=useState({}),pcs=useRef({}),ls=useRef(),lv=useRef(),ice=useRef({}),cfg=useRef({}),cur=useRef();
  const leave=()=>{if(cur.current)sock.current.emit('gcall:leave');Object.values(pcs.current).forEach(p=>p.close());pcs.current={};ice.current={};ls.current?.getTracks().forEach(t=>t.stop());ls.current=null;cur.current=null;setStreams({});setSt(null)};
  const mk=(id,name)=>{const p=new RTCPeerConnection(cfg.current);pcs.current[id]=p;ls.current.getTracks().forEach(t=>p.addTrack(t,ls.current));
    p.onicecandidate=e=>e.candidate&&sock.current.emit('gcall:signal',{to:id,conv:cur.current,data:{c:e.candidate}});p.ontrack=e=>setStreams(x=>({...x,[id]:{name,stream:e.streams[0]}}));return p};
  const join=async(conv,title,video)=>{if(cur.current)return;
    try{ls.current=await navigator.mediaDevices.getUserMedia({audio:true,video})}catch{return alert('Camera/mic unavailable (needs HTTPS or localhost)')}
    lv.current.srcObject=ls.current;lv.current.style.display=video?'block':'none';cfg.current={iceServers:await api('ice')};cur.current=conv;setSt({conv,title,video,phase:'live'});
    sock.current.emit('gcall:join',{conv,video},async r=>{if(r?.error){alert('Call is full (max 6)');return leave()}
      for(const p of r.peers){const c=mk(p.id,p.name),o=await c.createOffer();await c.setLocalDescription(o);sock.current.emit('gcall:signal',{to:p.id,conv,data:{sdp:o}})}})};
  const toggle=k=>ls.current?.getTracks().filter(t=>t.kind===k).forEach(t=>t.enabled=!t.enabled);
  useEffect(()=>{const s=sock.current,h={
    'gcall:signal':async({from,name,data})=>{
      if(data.sdp){const p=data.sdp.type==='offer'?(pcs.current[from]||(ls.current&&mk(from,name))):pcs.current[from];if(!p)return;
        await p.setRemoteDescription(data.sdp);(ice.current[from]||[]).forEach(c=>p.addIceCandidate(c));ice.current[from]=[];
        if(data.sdp.type==='offer'){const a=await p.createAnswer();await p.setLocalDescription(a);s.emit('gcall:signal',{to:from,conv:cur.current,data:{sdp:a}})}}
      else if(data.c){const p=pcs.current[from];p?.remoteDescription?p.addIceCandidate(data.c):(ice.current[from]=[...(ice.current[from]||[]),data.c])}},
    'gcall:left':({id})=>{pcs.current[id]?.close();delete pcs.current[id];setStreams(x=>{const n={...x};delete n[id];return n})},
    'gcall:ring':d=>{if(!cur.current)setSt({conv:d.conv,title:d.name+' is calling…',video:d.video,phase:'incoming'})},
    'gcall:ring-cancel':({conv})=>setSt(x=>x?.phase==='incoming'&&x.conv===conv?null:x)};
    Object.entries(h).forEach(([e,f])=>s.on(e,f));return()=>Object.entries(h).forEach(([e,f])=>s.off(e,f))},[]);
  return {st,streams,join,leave,toggle,lv,accept:()=>join(st.conv,st.title,st.video),decline:()=>setSt(null)};
}
const Vid=({s,name})=>{const r=useRef();useEffect(()=>{r.current.srcObject=s},[s]);return <div className="tile"><video ref={r} autoPlay playsInline/><span>{name}</span></div>};
function CallUI({call:{st,streams,accept,decline,leave,toggle,lv}}){
  return <div className="call" style={{display:st?'flex':'none'}}><div className="grid">{Object.entries(streams).map(([id,v])=><Vid key={id} s={v.stream} name={v.name}/>)}</div><video ref={lv} className="lv" autoPlay playsInline muted/>
    <h3>{st?.title}{st?.phase==='live'&&!Object.keys(streams).length?' — waiting for others…':''}</h3>
    <div style={{display:'flex',gap:8}}>{st?.phase==='incoming'?<><button onClick={accept}>Accept</button><button className="red" onClick={decline}>Decline</button></>:<><button className="s" onClick={()=>toggle('audio')}>Mute</button><button className="s" onClick={()=>toggle('video')}>Camera</button><button className="red" onClick={leave}>Leave</button></>}</div></div>;
}
function Main({me,setMe}){
  const [tab,setTab]=useState('chats'),[convs,setConvs]=useState([]),[active,setActive]=useState(null),[online,setOnline]=useState([]),[toast,setToast]=useState('');
  const [kp,setKp]=useState(null),sock=useRef(null);if(!sock.current)sock.current=io({auth:{token:tk()}});
  const call=useCall(sock),load=useCallback(()=>api('conversations').then(setConvs),[]);
  useEffect(()=>{const s=sock.current;load();ensureKeys(me.id).then(setKp).catch(console.error);
    s.on('online',setOnline);s.on('presence',({id,on})=>setOnline(o=>on?[...new Set([...o,id])]:o.filter(x=>x!==id)));
    s.on('message',m=>{load();if(m.sender_id!==me.id)setToast(m.sender+': '+(m.body?.startsWith('e2e:')?'New message':m.body||'📎'))});s.on('read',load);s.on('notify',setToast);
    return()=>s.close()},[]);
  useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),3000);return()=>clearTimeout(t)}},[toast]);
  const open=async uid=>{const {id}=await api('conversations','POST',{user:uid});await load();setActive(id);setTab('chats')};
  const group=async()=>{const title=prompt('Group name');if(!title)return;const u=prompt('Usernames, comma separated');if(!u)return;try{const {id}=await api('groups','POST',{title,usernames:u.split(',')});await load();setActive(id)}catch(e){alert(e.message)}};
  const conv=convs.find(c=>c.id===active);
  return <div className="app"><div className={'side '+(active?'hide':'')}>
    <nav>{['chats','feed','search','me'].map(t=><button key={t} className={tab===t?'on':''} onClick={()=>setTab(t)}>{t[0].toUpperCase()+t.slice(1)}</button>)}</nav>
    <div className="list">
      {tab==='chats'&&<><button className="s" style={{width:'100%',marginBottom:8}} onClick={group}>+ New group</button>{convs.map(c=>{const o=c.others?.[0],title=c.is_group?c.title:o?.name;
        return <div key={c.id} className="row" onClick={()=>setActive(c.id)}><Av n={title} on={!c.is_group&&online.includes(o?.id)}/><div className="grow"><b>{title}</b><div className="m ell">{c.last?preview(c.last.body):'No messages'}</div></div>{c.unread>0&&<span className="badge">{c.unread}</span>}</div>})}
        {!convs.length&&<div className="m">No chats yet — find people in Search.</div>}</>}
      {tab==='feed'&&<Feed/>}{tab==='search'&&<Search open={open}/>}
      {tab==='me'&&<Me me={me} setMe={setMe}/>}
    </div></div>
    <div className={'main '+(active?'':'hide')}>{conv?<Chat key={conv.id} conv={conv} me={me} kp={kp} sock={sock} online={online} call={call} back={()=>setActive(null)}/>:<div className="empty">Select a chat to start messaging</div>}</div>
    <CallUI call={call}/>{toast&&<div className="toast">{toast}</div>}</div>;
}
function Chat({conv,me,sock,online,call,kp,back}){
  const [msgs,setMsgs]=useState([]),[read,setRead]=useState(0),[text,setText]=useState(''),[typing,setTyping]=useState(false),end=useRef(),s=sock.current,o=conv.others?.[0],title=conv.is_group?conv.title:o?.name;
  const peer=!conv.is_group&&o?.pubkey,lock=!!(peer&&kp),dm=async m=>m.body?.startsWith('e2e:')&&lock?{...m,body:await dec(kp,peer,m.body)}:m;
  useEffect(()=>{api(`conversations/${conv.id}/messages`).then(async r=>{setMsgs(await Promise.all(r.messages.map(dm)));setRead(r.otherRead)});s.emit('read',{conv:conv.id});let t;
    const onM=async m=>{if(m.conv!==conv.id)return;const mm=await dm(m);setMsgs(x=>x.some(y=>y.id===mm.id)?x:[...x,mm]);if(m.sender_id!==me.id)s.emit('read',{conv:conv.id})};
    const onR=r=>{if(r.conv===conv.id&&r.uid!==me.id)setRead(r.upto)};
    const onT=d=>{if(d.conv===conv.id){setTyping(true);clearTimeout(t);t=setTimeout(()=>setTyping(false),1500)}};
    s.on('message',onM);s.on('read',onR);s.on('typing',onT);return()=>{s.off('message',onM);s.off('read',onR);s.off('typing',onT)}},[conv.id,kp]);
  useEffect(()=>end.current?.scrollIntoView(),[msgs]);
  const send=async media=>{if(!text.trim()&&!media)return;let body=text;if(body&&lock)body=await enc(kp,peer,body);s.emit('message',{conv:conv.id,body,media});setText('')};
  return <><div className="head"><button className="s" onClick={back}>←</button><Av n={title} on={!conv.is_group&&online.includes(o?.id)}/>
    <div className="grow"><b>{title}</b><div className="m">{typing?'typing…':(lock?'🔒 ':'')+(conv.is_group?'Group':online.includes(o?.id)?'online':'offline')}</div></div>
    <button className="s" onClick={()=>call.join(conv.id,title,false)}>📞</button><button onClick={()=>call.join(conv.id,title,true)}>🎥</button></div>
    <div className="msgs">{msgs.map(m=>{const mine=m.sender_id===me.id;return <div key={m.id} className={'msg '+(mine?'me':'')}>
      {conv.is_group&&!mine&&<div className="m"><b>@{m.sender}</b></div>}{m.media&&(isImg(m.media)?<img src={m.media}/>:<a href={m.media} target="_blank">📎 file</a>)}{m.body}
      <small>{new Date(m.created).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} {mine&&(m.id<=read?<span style={{color:'#86efac'}}>✓✓</span>:'✓')}</small></div>})}<div ref={end}/></div>
    <div className="bar"><label className="s" style={{padding:'8px 12px',borderRadius:10,cursor:'pointer'}}>📎<input type="file" hidden onChange={async e=>{const f=e.target.files[0];if(f)send(await upload(f))}}/></label>
      <input value={text} placeholder={lock?'Encrypted message':'Message'} onChange={e=>{setText(e.target.value);s.emit('typing',{conv:conv.id})}} onKeyDown={e=>e.key==='Enter'&&send()}/><button onClick={()=>send()}>Send</button></div></>;
}
function Search({open}){
  const [q,setQ]=useState(''),[u,setU]=useState([]);
  const run=v=>{setQ(v);api('users?q='+encodeURIComponent(v)).then(setU)};useEffect(()=>run(''),[]);
  const fol=async x=>{const r=await api('follow/'+x.id,'POST');setU(l=>l.map(y=>y.id===x.id?{...y,following:r.following}:y))};
  return <><input placeholder="Search username or name" value={q} onChange={e=>run(e.target.value)}/>{u.map(x=><div key={x.id} className="row"><Av n={x.name}/><div className="grow"><b>{x.name}</b><div className="m ell">@{x.username} {x.bio}</div></div>
    <button className="s" onClick={()=>fol(x)}>{x.following?'Following':'Follow'}</button><button onClick={()=>open(x.id)}>Chat</button></div>)}</>;
}
function Feed(){
  const [posts,setP]=useState([]),[stories,setS]=useState([]),[cap,setCap]=useState(''),[img,setImg]=useState(null),[view,setView]=useState(null);
  const load=()=>{api('feed?all=1').then(setP);api('stories').then(setS)};useEffect(load,[]);
  const post=async()=>{await api('posts','POST',{caption:cap,image:img});setCap('');setImg(null);load()};
  const story=async e=>{const f=e.target.files[0];if(f){await api('stories','POST',{media:await upload(f)});load()}};
  const act=async(p,k,b)=>{await api(`posts/${p.id}/${k}`,'POST',b);load()};
  return <>{view&&<div className="view" onClick={()=>setView(null)}><img src={view.media}/><div>@{view.username}</div></div>}
    <div className="stories"><label className="st" style={{display:'grid',placeItems:'center',background:'var(--c)'}}>＋<input type="file" accept="image/*" hidden onChange={story}/></label>{stories.map(s=><img key={s.id} className="st" src={s.media} title={s.username} onClick={()=>setView(s)}/>)}</div>
    <textarea rows="2" placeholder="Share something…" value={cap} onChange={e=>setCap(e.target.value)}/><div style={{display:'flex',gap:8,margin:'8px 0'}}>
    <input type="file" accept="image/*" onChange={async e=>e.target.files[0]&&setImg(await upload(e.target.files[0]))}/><button onClick={post}>Post</button></div>
    {posts.map(p=><div key={p.id} className="post"><div><b>@{p.username}</b> <span className="m">{new Date(p.created).toLocaleString()}</span></div>{p.image&&<img src={p.image}/>}
      <div>{p.caption}<div style={{margin:'8px 0'}}><span className="act" onClick={()=>act(p,'like')}>{p.liked?'❤️':'🤍'} {p.likes}</span><span className="act" onClick={()=>{const t=prompt('Comment');t&&act(p,'comment',{text:t})}}>💬 {p.comments.length}</span></div>
      {p.comments.map((c,i)=><div key={i} className="m"><b>{c.by}</b> {c.text}</div>)}</div></div>)}</>;
}
function Me({me,setMe}){
  const edit=async()=>{const name=prompt('Display name',me.name);if(name===null)return;const bio=prompt('Bio',me.bio||'');setMe(await api('me','PUT',{name,bio:bio||''}))};
  return <div style={{padding:10}}><div className="row"><Av n={me.name}/><div><b>{me.name}</b><div className="m">@{me.username}</div></div></div><p>{me.bio}</p>
    <div style={{display:'flex',gap:8}}><button className="s" onClick={edit}>Edit profile</button><button className="s" onClick={enablePush}>🔔 Notifications</button><button className="red" onClick={()=>{localStorage.clear();location.reload()}}>Log out</button></div></div>;
}
