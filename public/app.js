'use strict';
const $ = (sel,root=document) => root.querySelector(sel);
const app=$('#app');
const toastNode=$('#toast');
const storageKey='pooky-pixel-panic-session';
const usedKey='pooky-pixel-panic-used-products';
function storedUsed(){try{const arr=JSON.parse(localStorage.getItem(usedKey)||'[]');return Array.isArray(arr)?arr.filter(v=>typeof v==='string').slice(0,500):[];}catch{return [];}}
function rememberFinishedGame(){if(state?.phase!=='finished'||!Array.isArray(state.usedFamilies))return;const all=new Set([...storedUsed(),...state.usedFamilies]);localStorage.setItem(usedKey,JSON.stringify([...all]));}
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const pad=n=>String(Math.max(0,n)).padStart(2,'0');
let token=null, state=null, source=null, lastView='', lastRoundKey='', lastActivityKey='', timerHandle=null, toastTimeout=null, paintCount=-1;
let picture=null, sourceCanvas=null, imageReady=false, expectedImage='', drawing=false;

function toast(msg,bad=false){toastNode.textContent=msg;toastNode.className='toast show'+(bad?' bad':'');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>toastNode.classList.remove('show'),2700);}
async function api(path,data={}){
  const response=await fetch('/api/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...data,token})});
  let body;try{body=await response.json();}catch{throw Error('Could not reach the game server.');}
  if(!response.ok||!body.ok)throw Error(body.error||'Something went wrong.');
  return body;
}
const safe=async fn=>{try{await fn();}catch(e){toast(e.message,true);}};
function setRoom(result){
  token=result.token;
  localStorage.setItem(storageKey,token);
  state=result.state;
  rememberFinishedGame();connectEvents();render(true);
  if(state.code){history.replaceState(null,'',`/?room=${encodeURIComponent(state.code)}`);}
}
function connectEvents(){
  if(source){source.close();source=null;}
  if(!token)return;
  source=new EventSource('/api/events?token='+encodeURIComponent(token));
  source.onmessage=(event)=>{try{const newState=JSON.parse(event.data);const oldPhase=state?.phase,oldRound=state?.round,oldCount=state?.players?.length,oldGame=state?.gameId;state=newState;rememberFinishedGame();render(!oldPhase||oldPhase!==state.phase||oldRound!==state.round||oldCount!==state.players.length||oldGame!==state.gameId);}catch(e){console.warn(e);}};
  source.onerror=()=>{/* EventSource automatically reconnects after brief network interruptions. */};
}
function resetToHome(){
  if(source){source.close();source=null;}
  token=null;state=null;localStorage.removeItem(storageKey);lastView='';lastRoundKey='';
  history.replaceState(null,'','/');render(true);
}
function introMarkup(){
  const maybeCode=new URLSearchParams(location.search).get('room')||'';
  return `<div class="hero">
    <section class="hero-copy">
      <div class="eyebrow">THE ULTIMATE LIGHTING SHOWDOWN</div>
      <h1>Pixel<br><span class="orange">Panic!</span></h1>
      <p>Know your Trindle from your Twinky? Race your colleagues to name the Pooky product before the pixels disappear.</p>
      <div class="hero-features"><span class="pill">✦ 10 rounds</span><span class="pill">◷ 60 seconds</span><span class="pill">◈ Up to 20 players</span></div>
      <div class="form-panel">
        <h3>Ready to play?</h3><p class="subtle">No password needed. Just a nickname and a room code.</p>
        <form id="create-form"><div class="form-row"><input class="field" id="nickname" aria-label="Your nickname" placeholder="Your nickname" maxlength="24" minlength="2" autocomplete="nickname" required/><button class="btn btn-primary" type="submit">Create game <span>↗</span></button></div></form>
        <form id="join-form"><div class="join-row"><input class="field" id="room-input" aria-label="Room code" placeholder="ROOM CODE" value="${escapeHtml(maybeCode)}" maxlength="5" required/><button class="btn btn-white" type="submit" style="flex:1">Join a friend's room →</button></div></form>
      </div>
    </section>
    <aside class="hero-art" aria-label="Abstract illustration of a lamp emerging from pixelated blocks">
      <div class="art-asterisk">✳</div><div class="art-stage"><div class="art-pixels"></div><div class="art-circle"></div><div class="art-clear"><svg viewBox="0 0 200 280" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><ellipse cx="100" cy="260" rx="71" ry="11" fill="#cdb7a0"/><path d="M90 90V136" stroke="#b39369" stroke-width="9"/><path d="M72 136Q60 159 75 181Q42 223 74 247Q100 262 126 247Q158 223 125 181Q140 159 128 136Z" fill="#ed7b52" stroke="#cd6244" stroke-width="4"/><path d="M45 82L67 21H133L155 82Z" fill="#ead6a8" stroke="#ae8d60" stroke-width="4"/><rect x="67" y="247" width="67" height="8" rx="4" fill="#ab775d"/></svg></div></div>
      <div class="art-sticker top">WHAT ON EARTH IS THAT? 👀</div><div class="art-sticker bottom">GUESS IT FIRST. WIN BIG. ✨</div>
    </aside>
  </div>`;
}
function lobbyMarkup(){
  const youHost=state.you===state.host;
  const full=state.players.length>=state.maxPlayers;
  const canStart=state.players.length>=2&&state.remaining>=10;
  return `<section class="lobby"><div class="lobby-heading"><div class="eyebrow">YOUR GAME IS READY</div><h1>Bring on the <span style="color:var(--orange)">rivalry.</span></h1><p>Share your room code and get guessing.</p></div>
    <div class="lobby-grid"><div class="panel">
      <div class="panel-label">YOUR PRIVATE GAME CODE</div><div class="room-code">${escapeHtml(state.code)}</div>
      <div class="lobby-actions"><button class="btn btn-primary" id="copy-invite">↗ Copy invite link</button><button class="btn btn-white" id="copy-code">Copy code</button></div>
      <p class="room-note">Send the link to your colleagues. They enter a nickname and join from their own device. Everyone sees the same round and timer.</p>
      <div class="hint-card"><strong>✦ How to win</strong><br>Every five seconds, one new piece of the photo snaps into focus. Type the <b>product family name</b> (e.g. “Trindle”). The first correct answer wins the round. One-letter typos are accepted. Earlier guesses earn more points!</div>
    </div><div class="panel"><div class="panel-label">PLAYERS · ${state.players.length}/${state.maxPlayers}</div><h2>In the room</h2>
      <div class="players-list">${state.players.map((p,i)=>`<div class="player-entry"><span class="avatar p${i+1}">${escapeHtml(p.name.slice(0,1).toUpperCase())}</span><div class="player-meta"><b>${escapeHtml(p.name)} ${state.you===p.id?'(you)':''}</b><span>${i===0?'Game host':'Player '+(i+1)}</span></div><span class="online ${p.online?'':'waiting'}">${p.online?'● READY':'CONNECTING'}</span></div>`).join('')}
      ${!full?`<div class="player-entry" style="border:2px dashed #ddd0c8;background:#fff"><span class="avatar" style="background:#f1ebeb;color:#b3a6a7">?</span><div class="player-meta"><b>Waiting for more players</b><span>Send the invite link...</span></div><span class="online waiting">◌ EMPTY</span></div>`:''}</div>
      ${youHost?`<button class="btn btn-dark" id="start-game" ${canStart?'':'disabled'} style="width:100%">${canStart?'Let’s play! →':state.players.length<2?'Waiting for another player...':'Not enough unused products'}</button>`:`<button class="btn btn-dark" disabled style="width:100%">The host will start the game...</button>`}
      <p class="statusline">${state.catalogueLoading?'⏳ Fetching Pooky product photography...':'✓ Product catalogue checked.'} ${state.photos} / ${state.catalogueCount} real product photos loaded. ${state.photos<10?'Illustrated placeholders are used where photos cannot load.':''} <br><b>${state.remaining} unseen products available for a new match.</b></p>
    </div></div>
    ${youHost?`<details class="panel upload-panel"><summary>📷 Want to use your own Pooky product photos instead?</summary><p>Select 10 or more JPG, PNG or WebP files from your computer. Use filenames like <b>Trindle.jpg</b>, <b>Freya.jpg</b> or <b>Aspen.jpg</b> — the filename becomes the product name/accepted answer. This is ideal for a game using your studio product imagery. Uploaded photos are kept temporarily on this server and disappear if it restarts.</p><input type="file" class="filefield" id="upload-files" multiple accept="image/jpeg,image/png,image/webp"/><div class="upload-progress" id="upload-progress">${state.uploads} photo${state.uploads===1?'':'s'} uploaded</div>${state.uploads>=10?`<label class="choice"><input type="checkbox" id="use-custom" ${state.useCustom?'checked':''}/> Use my uploaded images for the next game</label>`:''}</details>`:''}
      ${youHost&&state.remaining<10?'<button class="btn btn-white" id="reset-used">Reset product history (allow repeats again)</button>':''}
    </section>`;
}
const playerScoreMarkup=(p,i)=>`<div class="scorebox ${i===0?'leader':''} ${p.id===state.you?'your-score':''}"><span class="score-rank">#${i+1}</span><span class="avatar">${escapeHtml(p.name[0].toUpperCase())}</span><div style="min-width:0"><div class="score-name">${escapeHtml(p.name)}${p.id===state.you?' (you)':''}</div><div class="score-points">${p.score.toLocaleString('en-GB')}</div><div class="score-wins">${p.wins} round${p.wins===1?'':'s'} won</div></div></div>`;
function gameMarkup(){
  const isReveal=state.phase==='reveal';
  const itemReady=state.source==='photo';
  const youWon=isReveal&&state.winner===state.you;
  const who=state.players.find(p=>p.id===state.winner);
  const roundEnd=isReveal?`<div class="round-result ${state.winner?(youWon?'':'lose-result'):'no-guess'}"><h3>${state.winner?(youWon?'🎉 You got it!':'⚡ '+escapeHtml(who?.name||'Someone')+' got it!'):'⏰ Time’s up!'}</h3><p>The answer was <b>${escapeHtml(state.answer)}</b>.</p>${state.productUrl?`<a href="${escapeHtml(state.productUrl)}" target="_blank" rel="noopener noreferrer">View product on Pooky ↗</a>`:''}<p style="margin-top:8px;font-size:11px">Next round starting automatically...</p></div>`:'';
  return `<section class="game"><div class="game-heading"><div><div class="round-kicker">THE PRODUCT CHALLENGE</div><h2 class="game-title">Round <span style="color:var(--orange)">${state.round}</span> <span style="color:#bcaeab">/ ${state.total}</span></h2></div><div class="round-bars" aria-label="Round progress">${Array.from({length:state.total},(_,i)=>`<span class="${i<state.round-1?'passed':i===state.round-1?'active':''}"></span>`).join('')}</div></div>
  <div class="stage"><div class="image-stage" id="image-stage"><canvas id="pixel-canvas" class="pixel-canvas" width="800" height="800" aria-label="Product image gradually being revealed"></canvas><div class="stage-top"><span class="stage-tag ${isReveal?'revealed':'orange'}">${isReveal?'✓ REVEALED':'◈ WHAT’S THAT LIGHT?'}</span><span class="stage-tag">${state.round} / 10</span></div><div class="stage-corner">${itemReady?'REAL POOKY PHOTO':'ILLUSTRATED DEMO IMAGE'}</div><div id="loading-photo" class="stage-spinner">Loading image...</div></div>
    <div class="aside"><div class="timer-card"><div class="timer-head"><span>${isReveal?'ROUND COMPLETE':'TIME LEFT'}</span><span>${isReveal?'✓':'◷ 60 SECONDS'}</span></div><div class="timer-num" id="timer-num">${isReveal?'00':'60'}<span>SEC</span></div><div class="progress-rail"><div class="progress-fill" id="timer-fill"></div></div><div class="reveal-caption"><span>PICTURE REVEAL</span><span id="reveal-count">0 / 12</span></div><div class="reveal-dots" id="reveal-dots">${Array.from({length:12},()=>'<span></span>').join('')}</div></div>
      <div class="guess-card"><h3>Know the product?</h3><p>Be the first to name it. The faster you are, the more points you score.</p>
      <form class="guess-form" id="guess-form"><input id="guess-input" class="field guess-field" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" placeholder="Type a Pooky product name..." maxlength="90" ${isReveal?'disabled':''} required/><button class="btn btn-primary" type="submit" ${isReveal?'disabled':''}>${isReveal?'Waiting for next round...':'Submit guess ↗'}</button></form><p class="subfoot">Product family names work · e.g. “Freya” · one-character typos allowed</p>${roundEnd}</div></div></div>
  <div class="scoreboard">${[...state.players].sort((a,b)=>b.score-a.score||b.wins-a.wins).map((p,i)=>playerScoreMarkup(p,i)).join('')}</div></section>`;
}
function endMarkup(){
  const list=[...state.players].sort((a,b)=>b.score-a.score||b.wins-a.wins);
  const winners=list.filter(p=>p.score===list[0].score);
  const tied=winners.length>1;
  const hasNext=state.remaining>=state.total;
  const youHost=state.you===state.host;
  return `<section class="end"><div class="eyebrow" style="justify-content:center">10 ROUNDS. ONE FINAL SCORE.</div><h1>Game <span style="color:var(--orange)">over!</span></h1><p>${tied?'A tie at the top!':'The pixels have settled. The winner is...'}</p>
    <div class="winner-hero"><small>${tied?'🏆 JOINT CHAMPIONS':'🏆 THE PIXEL PANIC CHAMPION'}</small><strong>${escapeHtml(tied?winners.map(p=>p.name).join(' & '):winners[0].name)}</strong><p style="margin-top:12px">${tied?'A seriously close game!':'A true Pooky product expert. Respect.'}</p></div>
    <div class="result-scores">${list.map((p,i)=>`<div><small>#${i+1}</small> <span style="font-weight:800;font-size:14px">${escapeHtml(p.name)}</span><b>${p.score.toLocaleString('en-GB')}</b><span style="font-size:12px;color:#93888e">${p.wins} rounds won</span></div>`).join('')}</div>
    <p class="stock-note">${state.remaining} previously unseen products left in this catalogue. Rematches never reuse a product name until you explicitly reset the history.</p>
    ${youHost?`${hasNext?'<button id="play-again" class="btn btn-primary" style="font-size:16px;padding:17px 28px">Play again with 10 NEW products ↗</button>':'<p class="limit-note">Fewer than 10 new products remain, so a repeat-free rematch is unavailable.</p>'} <button id="reset-used" class="btn btn-white" style="margin-left:8px">Reset product history & allow repeats</button>`:'<p style="font-size:14px">Waiting for the host to start a rematch...</p>'}
    <div class="history"><h3>The round-by-round results</h3>${state.results.map(r=>`<div class="history-row"><span>ROUND ${r.round}</span><strong>${escapeHtml(r.answer)}</strong><span>${r.winner?'🏅 '+escapeHtml(r.winner):'No winner'}</span></div>`).join('')}</div>
    <button class="btn btn-white" id="leave-game" style="margin-top:26px">Exit game</button></section>`;
}

function render(force=false){
  const view=state?(state.phase==='lobby'?'lobby':state.phase==='finished'?'finished':'game'):'intro';
  const activityKey=state?`${state.players.map(p=>`${p.id}:${p.online}:${p.score}`).join('|')}:${state.uploads}:${state.photos}:${state.catalogueLoading}:${state.remaining}:${state.usedCount}`:'';
  const key=state?`${view}:${state.code}:${state.round}:${state.phase}:${state.gameId}`:view;
  if(!force&&key===lastView&&activityKey===lastActivityKey)return;
  lastView=key;lastActivityKey=activityKey;
  if(view==='intro')app.innerHTML=introMarkup();
  else if(view==='lobby')app.innerHTML=lobbyMarkup();
  else if(view==='finished')app.innerHTML=endMarkup();
  else {app.innerHTML=gameMarkup();mountImage();}
  attachEvents(view);
  if(view==='game'&&state.phase==='playing')$('#guess-input')?.focus({preventScroll:true});
  updateClock();
}
function attachEvents(view){
  if(view==='intro'){
    $('#create-form').onsubmit=e=>{e.preventDefault();const n=$('#nickname').value.trim();safe(async()=>setRoom(await api('create',{name:n,seen:storedUsed()})));};
    $('#join-form').onsubmit=e=>{e.preventDefault();const n=$('#nickname').value.trim(),code=$('#room-input').value.trim();safe(async()=>setRoom(await api('join',{name:n,code})));};
  }
  if(view==='lobby'){
    $('#copy-code').onclick=()=>copy(state.code);
    $('#copy-invite').onclick=()=>copy(`${location.origin}/?room=${state.code}`);
    const start=$('#start-game');if(start)start.onclick=()=>safe(async()=>{await api('start');});
    const files=$('#upload-files');if(files)files.onchange=()=>uploadFiles(files.files);
    const custom=$('#use-custom');if(custom)custom.onchange=()=>safe(async()=>{await api('catalogue',{custom:custom.checked});toast(custom.checked?'Your photos selected.':'Pooky catalogue selected.');});
  }
  if(view==='game'){
    const form=$('#guess-form');if(form)form.onsubmit=e=>{e.preventDefault();const input=$('#guess-input');const guess=input.value.trim();if(!guess)return;const button=$('button',form);button.disabled=true;safe(async()=>{try{const result=await api('guess',{guess});if(result.correct)toast(`Correct! +${result.points} points 🎉`);}finally{if(state?.phase==='playing'){button.disabled=false;input.value='';input.focus({preventScroll:true});}}});};
  }
  if(view==='lobby'||view==='finished'){
    const reset=$('#reset-used');if(reset)reset.onclick=()=>safe(async()=>{
      if(!confirm('Clear the list of previously played products? This allows products to appear again in future matches.'))return;
      await api('reset-history');localStorage.removeItem(usedKey);
      toast('Product history reset. Previous products can appear again.');
    });
  }
  if(view==='finished'){
    const again=$('#play-again');if(again)again.onclick=()=>safe(async()=>{await api('start');});
    $('#leave-game').onclick=resetToHome;
  }
}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('Copied to clipboard ✓');}catch{window.prompt('Copy this:',text);}}
async function uploadFiles(files){
  const list=Array.from(files||[]).slice(0,40);
  const progress=$('#upload-progress');if(!list.length)return;
  for(let i=0;i<list.length;i++){
    const file=list[i];
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5_000_000){toast(`Skipped ${file.name}: use JPG/PNG/WebP under 5 MB`,true);continue;}
    if(progress)progress.textContent=`Uploading ${i+1} / ${list.length}: ${file.name}`;
    try{
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Could not read file'));reader.readAsDataURL(file);});
      const title=file.name.replace(/\.[a-z0-9]+$/i,'').replace(/[_-]+/g,' ').trim();
      const family=title.split(/\s+/)[0]||title;
      await api('upload',{name:title,answer:family,data});
    }catch(e){toast(`Could not upload ${file.name}: ${e.message}`,true);}
  }
  toast('Photo uploads complete.');
}
function mountImage(){
  const cv=$('#pixel-canvas');if(!cv||!state.image)return;
  expectedImage=state.image;imageReady=false;picture=null;sourceCanvas=null;paintCount=-1;
  const img=new Image();picture=img;
  img.onload=()=>{
    if(expectedImage!==img.dataset.request)return;
    sourceCanvas=document.createElement('canvas');sourceCanvas.width=800;sourceCanvas.height=800;
    const ctx=sourceCanvas.getContext('2d');ctx.fillStyle='#f4f0e9';ctx.fillRect(0,0,800,800);
    const margin=32;const scale=Math.min((800-margin*2)/img.width,(800-margin*2)/img.height);
    const w=img.width*scale,h=img.height*scale;
    ctx.drawImage(img,(800-w)/2,(800-h)/2,w,h);
    imageReady=true;$('#loading-photo')?.remove();paintCount=-1;updateClock();
  };
  img.onerror=()=>{const el=$('#loading-photo');if(el)el.textContent='Could not load this photo';};
  img.dataset.request=state.image;img.src=state.image;
}
function paintReveal(revealed,fully=false){
  const canvas=$('#pixel-canvas');if(!canvas||!sourceCanvas||!imageReady)return;
  const count=fully?12:revealed;
  if(count===paintCount)return;paintCount=count;
  const ctx=canvas.getContext('2d',{alpha:false});
  // First draw an intentionally low-resolution (28 × 28) version, without smoothing.
  const tiny=document.createElement('canvas');tiny.width=28;tiny.height=28;
  tiny.getContext('2d').drawImage(sourceCanvas,0,0,28,28);
  ctx.imageSmoothingEnabled=false;ctx.drawImage(tiny,0,0,28,28,0,0,800,800);ctx.imageSmoothingEnabled=true;
  // Reveal one of 12 non-overlapping tiles every five seconds.
  for(let i=0;i<count;i++){
    const tile=state.revealOrder?.[i]??i;
    const col=tile%4,row=Math.floor(tile/4);
    const x=col*200,y=row*(800/3),w=200,h=800/3;
    ctx.drawImage(sourceCanvas,x,y,w,h,x,y,w,h);
  }
}
function updateClock(){
  if(!state||!['playing','reveal'].includes(state.phase))return;
  const playing=state.phase==='playing';
  const remains=playing?Math.max(0,(state.endsAt-Date.now())/1000):0;
  const elapsed=playing?60-remains:60;
  const revealed=playing?Math.min(12,Math.floor((elapsed+.0001)/5)):12;
  const timer=$('#timer-num');if(timer)timer.innerHTML=`${pad(Math.ceil(remains))}<span>SEC</span>`;
  const fill=$('#timer-fill');if(fill)fill.style.width=(remains/60*100)+'%';
  const count=$('#reveal-count');if(count)count.textContent=`${revealed} / 12`;
  const dots=$('#reveal-dots');if(dots)Array.from(dots.children).forEach((n,i)=>n.classList.toggle('done',i<revealed));
  paintReveal(revealed,!playing);
}
async function init(){
  timerHandle=setInterval(updateClock,90);
  const prev=localStorage.getItem(storageKey);
  if(prev){token=prev;try{const res=await fetch('/api/state?token='+encodeURIComponent(token));const info=await res.json();if(info.ok){state=info.state;connectEvents();render(true);return;}}catch{}token=null;localStorage.removeItem(storageKey);}
  render(true);
}
init();