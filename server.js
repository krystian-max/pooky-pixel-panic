'use strict';
/** POOKY PIXEL PANIC — dependency-free Node 20+ multiplayer server. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, 'public');
const ROUND_MS = 45_000;
const REVEAL_MS = 6_000;
const ROUND_COUNT = 10;
const MAX_PLAYERS = 20;
const rooms = new Map();
const sessions = new Map();
const streams = new Map();

// The exact product page URLs were checked against Pooky's UK catalogue in October 2026.
// The first word is accepted as the answer (e.g. "Trindle") — finishes are not required.
const BANK = [
  ['Trindle', 'Trindle rechargeable table lamp in bronze', 'trindle-rechargeable-table-lamp-in-bronze', 'table'],
  ['Freya', 'Freya rechargeable table lamp finished in brass', 'freya-rechargeable-table-lamp-finished-in-brass', 'table'],
  ['Ernest', 'Ernest rechargeable table lamp in antiqued brass', 'ernest-rechargeable-table-lamp-with-an-antiqued-brass-finish', 'table'],
  ['Aspen', 'Aspen pendant in antiqued brass', 'aspen-pendant-in-antiqued-brass', 'pendant'],
  ['Twinky', 'Twinky rechargeable table lamp in black with a brass hood', 'twinky-rechargeable-table-lamp-in-black-with-a-brass-hood', 'desk'],
  ['Chukka', 'Chukka rechargeable table lamp in bronze', 'chukka-rechargeable-table-lamp-in-bronze', 'table'],
  ['Spindle', 'Spindle rechargeable table lamp in aged brass', 'spindle-rechargeable-table-lamp-in-aged-brass', 'table'],
  ['Pickling', 'Pickling rechargeable table lamp in antiqued brass', 'pickling-rechargeable-table-lamp-in-antiqued-brass', 'desk'],
  ['Ellie', 'Ellie table lamp in emerald glaze', 'ellie-table-lamp-in-an-emerald-glaze', 'ceramic'],
  ['Reed', 'Reed rechargeable table lamp in bronze', 'reed-rechargeable-table-lamp-in-bronze', 'table'],
  ['Hestia', 'Hestia chandelier in brass with glass rods', 'hestia-chandelier-in-brass-with-glass-rods', 'chandelier'],
  ['Aurora', 'Tiny Aurora rechargeable table lamp in amber', 'tiny-aurora-rechargeable-table-lamp-in-amber', 'ceramic'],
  ['Knurloid', 'Knurloid rechargeable table lamp in bronze', 'knurloid-rechargeable-table-lamp-in-bronze', 'table'],
  ['Murphy', 'Murphy table lamp in green', 'murphy-table-lamp-in-green', 'ceramic'],
  ['Rita', 'Rita chandelier with clear blown glass droplets', 'rita-chandelier-with-clear-blown-glass-droplets', 'chandelier'],
  ['Walter', 'Walter rechargeable table lamp with an antiqued brass finish', 'walter-rechargeable-table-lamp-with-an-antiqued-brass-finish', 'table'],
  ['Orlando','Orlando rechargeable table lamp in silver','orlando-rechargeable-table-lamp-in-silver','table'],
  ['Utopia','Utopia rechargeable table lamp in white marble','utopia-rechargeable-table-lamp-in-white-marble','table'],
  ['Rattle','Smaller Rattle rechargeable table lamp','smaller-rattle-rechargeable-table-lamp','table'],
  ['Scoon','Scoon rechargeable table lamp in coconut','scoon-rechargeable-table-lamp-in-coconut','desk'],
  ['Lillee','Lillee rechargeable standing lamp in yellow','lillee-rechargeable-standing-lamp-in-yellow','table'],
  ['Karnak','Karnak rechargeable table lamp in brass and white marble','karnak-rechargeable-table-lamp-in-brass-and-white-marble','table'],
  ['Pick','Pick wall light in brass','pick-wall-light-in-brass','wall'],
  ['Whizzlet','Whizzlet wall light in brass','whizzlet-wall-light-in-brass','wall'],
  ['Vincent','Vincent wall light in antique brass','vincent-wall-light-in-antique-brass','wall'],
  ['Nova','Nova wall light in brass','nova-wall-light-in-brass','wall'],
  ['Andor','Double Andor IP54 adjustable wall light in brass','double-andor-ip54-adjustable-wall-light-in-brass','wall'],
  ['Meknes','Meknes wall light in brass','meknes-wall-light-in-brass','wall'],
  ['Schmorg','Schmorg IP54 wall light in brass','schmorg-wall-light-in-brass','wall'],
  ['Spencer','Spencer wall light in brass','spencer-wall-light-in-brass','wall'],
  ['Duet','Smaller Duet wall light in brass','smaller-duet-wall-light-in-brass','wall'],
  ['Katherine','Katherine table lamp in clear blown glass','katherine-table-lamp-in-clear-blown-glass','ceramic'],
  ['Kidd','Kidd wall light in aged brass','kidd-wall-light-in-aged-brass','wall'],
  ['Niche','Niche wall light in an antique brass finish','niche-wall-light-in-antique-brass-finish','wall'],
  ['Daniella','Daniella rechargeable table lamp in cut glass','daniella-rechargeable-table-lamp-in-cut-glass','ceramic'],
  ['Toby','Toby pendant in tortoiseshell resin','toby-pendant-in-tortoiseshell-resin','pendant'],
  ['Goodhew','Regular Goodhew pendant in white with gold interior','regular-goodhew-pendant-in-white-with-a-gold-interior-40cms-diameter','pendant'],
  ['Harlequin','Harlequin pendant in natural black and white','harlequin-pendant-in-natural-black-and-white','pendant'],
  ['Outline','Outline pendant in clear glass','outline-pendant-in-clear-glass','pendant'],
  ['Picchu','Picchu pendant in clear glass','picchu-pendant-in-clear-glass','pendant'],
  ['Demijohn','Regular Demijohn pendant in clear blown glass','regular-demijohn-pendant-in-clear-blown-glass','pendant'],
  ['Spangle','Spangle ball pendant in antique brass','spangle-ball-pendant-in-antique-brass','pendant'],
  ['Stig','Stig pendant in aged brass','stig-pendant-in-aged-brass','pendant'],
  ['Selene','Selene pendant in alabaster','selene-pendant-in-alabaster','pendant'],
  ['Tang','Tang pendant in bronze and glass','tang-pendant-in-bronze-and-glass','pendant'],
  ['Scrunch','Scrunch pendant in brass','scrunch-80cm-wide-pendant-in-brass','pendant'],
  ['Alvis','Alvis pendant in brass and chrome','alvis-pendant-in-brass-and-chrome','pendant'],
  ['Lolita','Larger Lolita table lamp in a stone glaze','lolita-table-lamp-in-a-stone-glaze','ceramic'],
].map(([family, name, handle, type]) => ({family, name, handle, type, url:`https://www.pooky.com/products/${handle}`, image:null, mime:null, photo:false}));

function drawDemoSvg(item) {
  // Offline fallback so the game can still be tested without an internet connection.
  // These are generic illustrations, NOT representations of Pooky's actual photography.
  const s = item.family.split('').reduce((v,ch)=>v+ch.charCodeAt(0),0);
  const c = ['#d6a84f','#8f713e','#8cbd95','#c98c66','#7c89ac'][s % 5];
  const cls = item.type;
  let shape = '';
  if (cls==='wall') shape = `<rect x="165" y="300" width="90" height="195" rx="35" fill="#77624f"/><path d="M210 390 Q380 300 470 410" stroke="#91744f" stroke-width="28" fill="none"/><path d="M430 355 Q520 320 610 390 L572 455 L464 458 Z" fill="${c}"/>`;
  else if (cls==='pendant') shape = `<path d="M400 40 V290" stroke="#715b45" stroke-width="14"/><path d="M190 420 Q270 270 400 250 Q530 270 610 420 L570 450 L230 450 Z" fill="${c}"/><ellipse cx="400" cy="444" rx="172" ry="20" fill="#6b493f"/>`;
  else if (cls==='chandelier') shape = `<path d="M400 44V256 M198 340 H600 M260 257 H542" stroke="#82604c" stroke-width="19" fill="none"/><g fill="${c}"><ellipse cx="200" cy="355" rx="46" ry="115"/><ellipse cx="302" cy="408" rx="39" ry="145"/><ellipse cx="406" cy="422" rx="42" ry="162"/><ellipse cx="508" cy="408" rx="39" ry="145"/><ellipse cx="610" cy="355" rx="46" ry="115"/></g>`;
  else if(cls==='desk') shape = `<path d="M395 320V600 M280 610H510" stroke="#73593e" stroke-width="28" stroke-linecap="round"/><path d="M255 328L320 215Q420 180 510 220L554 330Z" fill="${c}"/><rect x="366" y="585" width="74" height="32" rx="8" fill="#73593e"/>`;
  else if(cls==='ceramic') shape = `<path d="M388 240 V300" stroke="#786451" stroke-width="26"/><path d="M300 332 Q280 380 325 435 Q240 530 315 632 Q400 690 487 632 Q562 530 475 435 Q520 380 500 332 Z" fill="${c}" stroke="#a18e7a" stroke-width="10"/><path d="M260 235L305 135H495L540 235Z" fill="#eee1c2" stroke="#a99477" stroke-width="8"/>`;
  else shape = `<path d="M398 225V326" stroke="#9b7a54" stroke-width="22"/><path d="M310 340Q290 405 340 450Q370 480 340 530Q310 598 360 630L440 630Q488 598 456 530Q425 482 456 450Q505 408 490 340Z" fill="${c}" stroke="#82634b" stroke-width="8"/><rect x="290" y="631" width="220" height="25" rx="12" fill="#96754b"/><path d="M250 220L302 132H498L550 220Z" fill="#f1e2bb" stroke="#ba9b70" stroke-width="8"/>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="#f4f0e9"/><circle cx="400" cy="405" r="282" fill="#f9f6f1"/><ellipse cx="404" cy="691" rx="196" ry="18" fill="#dad0c4" opacity=".65"/>${shape}</svg>`);
}
for (const p of BANK) {p.image = drawDemoSvg(p); p.mime='image/svg+xml';}
let loading = true;
let loadedPhotos = 0;
async function getRemote(url, timeout=8000){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),timeout);
  try {return await fetch(url,{signal:controller.signal,headers:{'user-agent':'Mozilla/5.0 (compatible; PixelPanic/1.0)','accept':'application/json,text/html,image/*,*/*'}});}
  finally {clearTimeout(timer);}
}
function imageUrl(source){
  if (!source) return null;
  if (typeof source==='object') source=source.src || source.url;
  if (!source || typeof source!=='string') return null;
  if(source.startsWith('//')) source='https:'+source;
  if(source.startsWith('/')) source='https://www.pooky.com'+source;
  if(!/^https:\/\//i.test(source)) return null;
  return source;
}
async function hydrate(item){
  try {
    let img=null;
    // Shopify's public product endpoint is preferred; HTML Open Graph is a fallback.
    try {
      const response=await getRemote(`${item.url}.js`, 9000);
      if(response.ok){
        const product=await response.json();
        img=imageUrl(product.featured_image || product.images?.[0]);
      }
    }catch{}
    if(!img){
      const response=await getRemote(item.url,9000);
      if(response.ok){
        const html=await response.text();
        const meta=html.match(/<meta[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/i)
          ||html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
        if(meta)img=imageUrl(meta[1].replace(/&amp;/g,'&'));
      }
    }
    if(!img) throw Error('Could not find a Pooky product image');
    if (/\/cdn\/shop\//.test(img)) img+=(img.includes('?')?'&':'?')+'width=900';
    const photo=await getRemote(img, 9000);
    if(!photo.ok) throw Error(`Photo download returned ${photo.status}`);
    const mime=(photo.headers.get('content-type')||'').split(';')[0];
    if(!mime.startsWith('image/') || mime.includes('svg')) throw Error('Unexpected image content type');
    const arr=Buffer.from(await photo.arrayBuffer());
    if(arr.length<1000 || arr.length>8_000_000) throw Error('Unexpected photo size');
    item.image=arr; item.mime=mime; item.photo=true; loadedPhotos++;
    console.log('✓',item.family,'photo loaded');
  } catch(e) {console.log('·',item.family,'using illustrated fallback:',e.message);}
}
(async()=>{
  let i=0; async function worker(){while(i<BANK.length){const p=BANK[i++];await hydrate(p);}}
  await Promise.all(Array.from({length:5},worker));
  loading=false;
  console.log(`Catalogue ready. ${loadedPhotos}/${BANK.length} real Pooky photos.`);
  for (const r of rooms.values()) sendState(r);
})();

const token=()=>crypto.randomBytes(18).toString('hex');
const code=()=>crypto.randomBytes(3).toString('hex').slice(0,5).toUpperCase();
const shuffle=(list)=>{const a=[...list];for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;};
const norm=s=>String(s||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
function withinOneEdit(a,b){
  if(a===b)return true;
  if(Math.abs(a.length-b.length)>1)return false;
  let i=0,j=0,edits=0;
  while(i<a.length&&j<b.length){
    if(a[i]===b[j]){i++;j++;continue;}
    if(++edits>1)return false;
    if(a.length>b.length)i++;
    else if(b.length>a.length)j++;
    else{i++;j++;}
  }
  return edits+(a.length-i)+(b.length-j)<=1;
}
const identity=item=>norm(item.family);
function freshProducts(room){
  const pool=room.useCustom&&room.custom.length>=ROUND_COUNT?room.custom:BANK;
  return pool.filter(item=>!room.used.has(identity(item)));
}

function playerFor(tok){const roomCode=sessions.get(tok);const room=rooms.get(roomCode);if(!room)return null;const player=room.players.find(p=>p.token===tok);return player?{room,player}:null;}
function publicState(room,player){
  const playing=room.phase==='playing';
  const exposing=room.phase==='reveal';
  const product=(playing||exposing) ? room.deck[room.round] : null;
  return {
    code:room.code, phase:room.phase, you:player.id, host:room.host, round:room.round+1,
    total:ROUND_COUNT, roundSeconds:ROUND_MS/1000, maxPlayers:MAX_PLAYERS, remaining:freshProducts(room).length, usedCount:room.used.size, endsAt:playing?room.endsAt:null, revealUntil:exposing?room.revealUntil:null,
    image:product?`/api/image/${room.code}/${room.round}?v=${room.gameId}`:null,
    revealOrder:room.revealOrder, answer:exposing?product.name:null,
    productUrl:exposing?product.url||null:null,
    winner:exposing?room.roundWinner:null,
    players:room.players.map(p=>({id:p.id,name:p.name,score:p.score,wins:p.wins,online:p.online,roundPlace:p.roundPlace||0,roundPoints:p.roundPoints||0})),
    guessEvent:room.guessEvent||null, placements:room.roundPlacements||[],
    photos:loadedPhotos, catalogueCount:BANK.length, catalogueLoading:loading,
    source:room.deck?.[room.round]?.photo?'photo':'illustration',
    uploads:room.custom.length, useCustom:room.useCustom, gameId:room.gameId,
    results:room.phase==='finished'?room.history:[],
    usedFamilies:room.phase==='finished'?[...room.used]:[],
    history:room.history.slice(-3),
  };
}
function sseWrite(res,obj){try{res.write('data: '+JSON.stringify(obj)+'\n\n');}catch{}}
function sendState(room){for(const player of room.players){const r=streams.get(player.token);if(r) sseWrite(r, publicState(room,player));}}
function cancelTimers(room){clearTimeout(room.roundTimer);clearTimeout(room.nextTimer);room.roundTimer=null;room.nextTimer=null;}
function closeRoom(room){
  cancelTimers(room);
  for(const player of room.players){
    const stream=streams.get(player.token);
    if(stream){
      sseWrite(stream,{type:'room_closed',reason:'The host ended this game.',usedFamilies:[...room.used]});
      streams.delete(player.token);
      try{stream.end();}catch{}
    }
    sessions.delete(player.token);
  }
  rooms.delete(room.code);
}

function endRound(room){
  if(room.phase!=='playing')return;
  clearTimeout(room.roundTimer);
  room.phase='reveal';
  const first=room.roundPlacements?.[0];
  room.roundWinner=first?.playerId||null;
  const item=room.deck[room.round];
  room.history.push({round:room.round+1,answer:item.name,winner:first?room.players.find(p=>p.id===first.playerId)?.name||null:null,placements:(room.roundPlacements||[]).map(p=>({...p})),productUrl:item.url||null});
  room.revealUntil=Date.now()+REVEAL_MS;
  sendState(room);
  room.nextTimer=setTimeout(()=>{if(!rooms.has(room.code))return;if(room.round>=ROUND_COUNT-1){room.phase='finished';sendState(room);}else startRound(room);},REVEAL_MS);
}
function startRound(room){
  cancelTimers(room);
  room.round++;
  room.phase='playing'; room.endsAt=Date.now()+ROUND_MS;
  room.roundWinner=null; room.roundPlacements=[];room.guessEvent=null;
  room.players.forEach(p=>{p.roundPlace=0;p.roundPoints=0;p.lastGuess=0;});
  room.revealOrder=shuffle(Array.from({length:12},(_,i)=>i));
  room.roundTimer=setTimeout(()=>endRound(room),ROUND_MS);
  sendState(room);
}
function startGame(room){
  cancelTimers(room);
  room.players.forEach(p=>{p.score=0;p.wins=0;p.lastGuess=0;p.roundPlace=0;p.roundPoints=0;});
  const available=freshProducts(room);
  if(available.length<ROUND_COUNT)throw Error(`Only ${available.length} unseen products remain. At least ${ROUND_COUNT} are needed. Reset product history to start over.`);
  room.deck=shuffle(available).slice(0,ROUND_COUNT).map(item=>({...item}));
  for(const item of room.deck)room.used.add(identity(item));
  room.gameId=token().slice(0,8); room.history=[];room.round=-1;room.phase='playing';room.guessSeq=0;room.guessEvent=null;room.roundPlacements=[];
  startRound(room);
}
function fail(res,err,status=400){reply(res,{ok:false,error:err},status);}
function reply(res,value,status=200){const body=JSON.stringify(value);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'});res.end(body);}
function readJson(req,limit=11_000_000){return new Promise((resolve,reject)=>{let chunks=[],n=0;req.on('data',b=>{n+=b.length;if(n>limit){reject(Error('Upload too large'));req.destroy();}else chunks.push(b);});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'));}catch{reject(Error('Invalid JSON'));}});req.on('error',reject);});}
function serveStatic(req,res,pathname){const paths={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css'};const name=paths[pathname];if(!name){res.writeHead(404);return res.end('Not found');}const filename=path.join(ROOT,name);const mime=name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html';res.writeHead(200,{'content-type':`${mime}; charset=utf-8`,'cache-control':'no-cache','x-content-type-options':'nosniff'});fs.createReadStream(filename).pipe(res);}
async function handle(req,res){
  const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  const pathname=u.pathname;
  if(req.method==='GET'&&pathname==='/healthz') return reply(res,{ok:true,rooms:rooms.size,photos:loadedPhotos});
  if(req.method==='GET'&&pathname==='/api/status') return reply(res,{ok:true,photos:loadedPhotos,total:BANK.length,loading});
  if(req.method==='GET'&&pathname==='/api/state') {const p=playerFor(u.searchParams.get('token'));return p?reply(res,{ok:true,state:publicState(p.room,p.player)}):fail(res,'Room no longer exists',404);}
  if(req.method==='GET'&&pathname==='/api/events'){
    const tok=u.searchParams.get('token');const p=playerFor(tok);
    if(!p)return fail(res,'Session expired',404);
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
    res.write(': connected\n\n');const previous=streams.get(tok);if(previous&&previous!==res){try{previous.end();}catch{}}
    streams.set(tok,res);p.player.online=true;sseWrite(res,publicState(p.room,p.player));sendState(p.room);
    const keep=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},20000);
    req.on('close',()=>{clearInterval(keep);if(streams.get(tok)===res){streams.delete(tok);p.player.online=false;sendState(p.room);}});
    return;
  }
  const imageMatch=pathname.match(/^\/api\/image\/([A-Z0-9]{5})\/(\d+)$/);
  if(req.method==='GET'&&imageMatch){
    const room=rooms.get(imageMatch[1]),i=Number(imageMatch[2]);
    if(!room||!room.deck||i>room.round||i<0||i>=room.deck.length){res.writeHead(404);return res.end('No image');}
    const item=room.deck[i];res.writeHead(200,{'content-type':item.mime,'cache-control':'private, no-store','x-content-type-options':'nosniff'});return res.end(item.image);
  }
  if(req.method==='GET')return serveStatic(req,res,pathname);
  if(req.method!=='POST')return fail(res,'Not supported',405);
  let b;try{b=await readJson(req);}catch(e){return fail(res,e.message);}
  if(pathname==='/api/create'){
    const name=String(b.name||'').trim().slice(0,24);if(name.length<2)return fail(res,'Enter a name (at least 2 characters).');
    let key;do{key=code();}while(rooms.has(key));
    const tok=token(),player={id:'P1',name,token:tok,score:0,wins:0,online:false,lastGuess:0};
    const excludes=Array.isArray(b.seen)?b.seen.slice(0,500).filter(v=>typeof v==='string').map(v=>norm(v.slice(0,100))).filter(Boolean):[];
    const room={code:key,host:'P1',players:[player],phase:'lobby',round:-1,deck:[],history:[],custom:[],useCustom:false,used:new Set(excludes),gameId:'0',guessSeq:0,guessEvent:null,roundPlacements:[],createdAt:Date.now()};
    rooms.set(key,room);sessions.set(tok,key);return reply(res,{ok:true,token:tok,state:publicState(room,player)});
  }
  if(pathname==='/api/join'){
    const name=String(b.name||'').trim().slice(0,24),key=String(b.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(name.length<2)return fail(res,'Enter a name (at least 2 characters).');
    const room=rooms.get(key);if(!room)return fail(res,'Room not found. Double-check the code.');
    if(room.players.length>=MAX_PLAYERS)return fail(res,`Room is full — maximum ${MAX_PLAYERS} players.`);
    if(room.phase!=='lobby')return fail(res,'This game has already started.');
    const nextId=Math.max(0,...room.players.map(p=>Number(p.id.slice(1))||0))+1;
    const tok=token(),player={id:`P${nextId}`,name,token:tok,score:0,wins:0,online:false,lastGuess:0};
    room.players.push(player);sessions.set(tok,key);sendState(room);return reply(res,{ok:true,token:tok,state:publicState(room,player)});
  }
  const p=playerFor(b.token);if(!p)return fail(res,'Session expired. Create or join another room.',401);
  const {room,player}=p;
  if(pathname==='/api/cancel'){
    if(player.id!==room.host)return fail(res,'Only the host can cancel the whole game.',403);
    closeRoom(room);
    return reply(res,{ok:true});
  }
  if(pathname==='/api/leave'){
    if(player.id===room.host)return fail(res,'The host must cancel the game to leave.',403);
    const liveStream=streams.get(player.token);
    if(liveStream){streams.delete(player.token);try{liveStream.end();}catch{}}
    sessions.delete(player.token);
    room.players=room.players.filter(p=>p.token!==player.token);
    sendState(room);
    return reply(res,{ok:true});
  }
  if(pathname==='/api/start'){
    if(player.id!==room.host)return fail(res,'Only the host can start a game.');
    if(room.players.length<2)return fail(res,'Invite at least one other player first.');
    if(!['lobby','finished'].includes(room.phase))return fail(res,'Game already in progress.');
    if(freshProducts(room).length<ROUND_COUNT)return fail(res,`Only ${freshProducts(room).length} unused products remain. Reset product history to play another 10-round match.`);
    startGame(room);return reply(res,{ok:true});
  }
  if(pathname==='/api/guess'){
    if(room.phase!=='playing')return fail(res,'Round is not accepting guesses.');
    const now=Date.now();if(now>=room.endsAt){endRound(room);return fail(res,'Time ran out!');}
    if(player.roundPlace)return reply(res,{ok:true,alreadyCorrect:true,place:player.roundPlace,points:player.roundPoints});
    const raw=String(b.guess||'').trim().slice(0,90);
    const guess=norm(raw);if(guess.length<2)return fail(res,'Type a product name.');
    if(now-player.lastGuess<900)return fail(res,'Give it a second before trying again.');
    player.lastGuess=now;
    const current=room.deck[room.round];const valid=[current.family,current.name, current.name.replace(/^tiny\s/i,'')].map(norm);
    const fullTokens=norm(current.name).split(' ');
    const family=norm(current.family);
    const reasonableLongName=guess.startsWith(family+' ') && guess.split(' ').every(word=>fullTokens.includes(word));
    const correct=valid.some(answer=>withinOneEdit(guess,answer))||reasonableLongName;
    let place=0,points=0;
    if(correct){
      place=room.roundPlacements.length+1;
      const seconds=Math.max(0,Math.ceil((room.endsAt-now)/1000));
      points=Math.max(50,Math.round(110+seconds*12-(place-1)*60));
      player.score+=points;
      player.roundPlace=place;player.roundPoints=points;
      if(place===1)player.wins++;
      room.roundPlacements.push({playerId:player.id,name:player.name,place,points});
    }
    room.guessEvent={seq:++room.guessSeq,playerId:player.id,guess:raw,correct,place,points,at:now};
    // Never finish a round because of a correct answer: all 45 seconds must elapse.
    sendState(room);
    return reply(res,{ok:true,correct,place,points});
  }
  if(pathname==='/api/upload'){
    if(player.id!==room.host)return fail(res,'Only the host can upload images.');
    if(room.phase!=='lobby'&&room.phase!=='finished')return fail(res,'Upload before starting the game.');
    if(room.custom.length>=40)return fail(res,'Maximum of 40 uploaded products.');
    const name=String(b.name||'').trim().slice(0,100);const family=String(b.answer||name).trim().slice(0,60);
    if(!name||!family||!b.data)return fail(res,'Missing product name or photo.');
    if(room.custom.some(item=>identity(item)===norm(family)))return fail(res,'That product name has already been uploaded. Use a different product.');
    const match=String(b.data).match(/^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/);
    if(!match)return fail(res,'Only JPG, PNG and WebP images are supported.');
    const bytes=Buffer.from(match[2],'base64');if(bytes.length>5_000_000||bytes.length<200)return fail(res,'Each image must be under 5 MB.');
    room.custom.push({family,name,handle:'',type:'table',url:null,image:bytes,mime:match[1],photo:true});
    room.useCustom=room.custom.length>=ROUND_COUNT;sendState(room);return reply(res,{ok:true,count:room.custom.length});
  }
  if(pathname==='/api/reset-history'){
    if(player.id!==room.host)return fail(res,'Only the host can reset product history.');
    if(!['lobby','finished'].includes(room.phase))return fail(res,'Wait for the current match to finish.');
    room.used.clear();sendState(room);return reply(res,{ok:true});
  }
  if(pathname==='/api/catalogue'){
    if(player.id!==room.host)return fail(res,'Only the host can change the catalogue.');
    if(!['lobby','finished'].includes(room.phase))return fail(res,'Choose before starting.');
    if(b.custom&&room.custom.length<ROUND_COUNT)return fail(res,'Upload at least 10 images first.');
    room.useCustom=Boolean(b.custom);sendState(room);return reply(res,{ok:true});
  }
  return fail(res,'Unknown action',404);
}
const server=http.createServer((req,res)=>{handle(req,res).catch(err=>{console.error(err);if(!res.headersSent)fail(res,'Unexpected server error',500);else res.end();});});
server.listen(PORT,'0.0.0.0',()=>console.log(`POOKY PIXEL PANIC: http://localhost:${PORT}`));
// Clear abandoned games periodically so a long-running server doesn't grow forever.
setInterval(()=>{for(const [key,r] of rooms){if(!r.players.some(p=>p.online) && ['finished','lobby'].includes(r.phase)&&r.createdAt&&Date.now()-r.createdAt>8*60*60*1000){cancelTimers(r);rooms.delete(key);r.players.forEach(p=>sessions.delete(p.token));}}},60*60*1000).unref();