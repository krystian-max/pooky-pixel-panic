'use strict';
const $ = (sel,root=document) => root.querySelector(sel);
const app=$('#app');
const toastNode=$('#toast');
const storageKey='pooky-pixel-panic-session';
const usedKey='pooky-pixel-panic-used-products';
function storedUsed(){try{const arr=JSON.parse(localStorage.getItem(usedKey)||'[]');return Array.isArray(arr)?arr.filter(v=>typeof v==='string').slice(0,500):[];}catch{return [];}}
function persistUsed(families){
  if(!Array.isArray(families))return;
  const all=new Set([...storedUsed(),...families]);
  localStorage.setItem(usedKey,JSON.stringify([...all]));
}
function rememberFinishedGame(){if(state?.phase==='finished')persistUsed(state.usedFamilies);}
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const pad=n=>String(Math.max(0,n)).padStart(2,'0');
let token=null, state=null, source=null, lastView='', lastRoundKey='', lastActivityKey='', timerHandle=null, toastTimeout=null, paintCount=-1;
let picture=null, sourceCanvas=null, imageReady=false, expectedImage='', drawing=false;
let lastGuessSeq=0;
const ordinal=n=>n+(n%100>=11&&n%100<=13?'th':({1:'st',2:'nd',3:'rd'}[n%10]||'th'));
function updateScores(){
  if(!state||!['playing','reveal'].includes(state.phase))return;
  const board=$('.scoreboard');
  const cards=board?new Map([...board.querySelectorAll('[data-player-id]')].map(n=>[n.dataset.playerId,n])):new Map();
  for(const p of state.players){
    const card=cards.get(p.id);if(!card)continue;
    const points=card.querySelector('.score-points');if(points)points.textContent=p.score.toLocaleString('en-GB');
    const place=card.querySelector('.round-rank');if(place)place.textContent=p.roundPlace?ordinal(p.roundPlace)+' · +'+p.roundPoints:'Still guessing';
  }
  if(board){
    const ranking=[...state.players].sort((a,b)=>b.score-a.score||b.wins-a.wins||a.name.localeCompare(b.name));
    ranking.forEach((p,i)=>{
      const card=cards.get(p.id);if(!card)return;
      if(board.children[i]!==card)board.insertBefore(card,board.children[i]||null);
      card.classList.toggle('leader',i===0);
      const rank=card.querySelector('.score-rank');if(rank)rank.textContent='#'+(i+1);
    });
  }
  const me=state.players.find(p=>p.id===state.you),input=$('#guess-input'),btn=$('#guess-form button');
  if(input)input.disabled=state.phase!=='playing'||Boolean(me?.roundPlace);
  if(btn){btn.disabled=state.phase!=='playing'||Boolean(me?.roundPlace);btn.textContent=me?.roundPlace?'✓ '+ordinal(me.roundPlace)+' place · +'+me.roundPoints:state.phase==='playing'?'Submit guess ↗':'Round complete';}
}
function guessFlash(event){
  if(!event||state.phase!=='playing')return;
  const card=Array.from(document.querySelectorAll('[data-player-id]')).find(n=>n.dataset.playerId===event.playerId);
  if(!card)return;
  card.classList.remove('guess-wrong','guess-right');card.querySelector('.guess-bubble')?.remove();void card.offsetWidth;
  card.classList.add(event.correct?'guess-right':'guess-wrong');
  const bubble=document.createElement('span');bubble.className='guess-bubble '+(event.correct?'correct':'incorrect');
  bubble.textContent=event.correct?ordinal(event.place)+' · +'+event.points+' points':'“'+event.guess+'” ✕';
  card.appendChild(bubble);
  const seq=event.seq;
  setTimeout(()=>{if(state?.guessEvent?.seq===seq||card.isConnected){card.classList.remove('guess-right','guess-wrong');bubble.remove();}},3300);
}

function toast(msg,bad=false){toastNode.textContent=msg;toastNode.className='toast show'+(bad?' bad':'');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>toastNode.classList.remove('show'),2700);}
async function api(path,data={}){
  const response=await fetch('/api/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...data,token})});
  let body;try{body=await response.json();}catch{throw Error('Could not reach the game server.');}
  if(!response.ok||!body.ok)throw Error(body.error||'Something went wrong.');
  return body;
}
const safe=async fn=>{try{await fn();}catch(e){toast(e.message,true);}};
function setRoom(result){
  token=result.token;lastGuessSeq=0;
  localStorage.setItem(storageKey,token);
  state=result.state;
  rememberFinishedGame();connectEvents();render(true);
  if(state.code){history.replaceState(null,'',`/?room=${encodeURIComponent(state.code)}`);}
}
function connectEvents(){
  if(source){source.close();source=null;}
  if(!token)return;
  source=new EventSource('/api/events?token='+encodeURIComponent(token));
  source.onmessage=(event)=>{try{
    const newState=JSON.parse(event.data);
    if(newState.type==='draw_lines'){if(state?.mode==='draw'&&newState.round===state.round-1)paintLines(newState.lines);return;}
    if(newState.type==='draw_clear'){if(state?.mode==='draw'&&newState.round===state.round-1)clearDrawing();return;}
    if(newState.type==='room_closed'){
      persistUsed(newState.usedFamilies);
      resetToHome();
      toast('The host ended the game. You can start or join a new one.');
      return;
    }
    const oldPhase=state?.phase,oldRound=state?.round,oldCount=state?.players?.length,oldGame=state?.gameId;
    state=newState;
    rememberFinishedGame();
    render(!oldPhase||oldPhase!==state.phase||oldRound!==state.round||oldCount!==state.players.length||oldGame!==state.gameId);
    updateScores();
    if(state.guessEvent&&state.guessEvent.seq!==lastGuessSeq){lastGuessSeq=state.guessEvent.seq;guessFlash(state.guessEvent);}
  }catch(e){console.warn(e);}};
  source.onerror=()=>{/* EventSource automatically reconnects after brief network interruptions. */};
}
function resetToHome(){
  if(source){source.close();source=null;}
  token=null;state=null;lastGuessSeq=0;localStorage.removeItem(storageKey);lastView='';lastRoundKey='';lastActivityKey='';
  history.replaceState(null,'','/');render(true);
}
async function leaveCurrentRoom(){
  if(!state)return;
  const isHost=state.you===state.host;
  if(isHost&&!window.confirm('Cancel this game for everyone and return to the main menu?'))return;
  if(isHost){
    await api('cancel');
    resetToHome();
    toast('Game cancelled. Back to the main menu.');
  }else{
    await api('leave');
    resetToHome();
    toast('You left the game. Back to the main menu.');
  }
}
function introMarkup(){
  const maybeCode=new URLSearchParams(location.search).get('room')||'';
  return `<div class="campaign">
    <div class="campaign-copy">
      <div class="campaign-kicker">✳ THE POOKY PRODUCT CHALLENGE</div>
      <h1>no two<br><em>ever the same.</em></h1>
      <p>A little lighting knowledge goes a long way. Can you name the Pooky product before the picture comes into focus?</p>
      <div class="campaign-chips"><span>10 rounds</span><span>45 seconds</span><span>up to 20 players</span></div>
      <div class="form-panel campaign-form">
        <h3>Ready for a little friendly competition?</h3>
        <p class="subtle">Create a room, invite your colleagues and let the guessing begin.</p>
        <form id="create-form"><div class="mode-picker" role="group" aria-label="Choose game mode">
          <label class="mode-option"><input type="radio" name="mode" value="pixel" checked><span class="mode-emoji">▦</span><strong>Pixel Panic</strong><small>Reveal & guess the name</small></label>
          <label class="mode-option"><input type="radio" name="mode" value="sku"><span class="mode-emoji">#</span><strong>SKU Showdown</strong><small>Type the product code</small></label>
          <label class="mode-option"><input type="radio" name="mode" value="draw"><span class="mode-emoji">✎</span><strong>Pooky Pictionary</strong><small>Draw for your colleagues</small></label>
        </div><div class="form-row"><input class="field" id="nickname" aria-label="Your nickname" placeholder="Your nickname" maxlength="24" minlength="2" autocomplete="nickname" required/><button class="btn btn-primary" type="submit">Create game →</button></div></form>
        <form id="join-form"><div class="join-row"><input class="field" id="room-input" aria-label="Room code" placeholder="ROOM CODE" value="${escapeHtml(maybeCode)}" maxlength="5" required/><button class="btn btn-white" type="submit" style="flex:1">Join a room →</button></div></form>
      </div>
    </div>
    <div class="campaign-images"><div class="photo-frame photo-one"><img src="/api/showcase/0" alt="Pooky lighting product" loading="eager"></div><div class="photo-frame photo-two"><img src="/api/showcase/1" alt="Pooky lighting product" loading="eager"></div><div class="photo-frame photo-three"><img src="/api/showcase/2" alt="Pooky lighting product" loading="eager"></div><span class="campaign-scribble">what's that<br>light? ↗</span></div>
  </div>
  <section class="collection-strip"><div><div class="collection-eyebrow">LET THE GAMES BEGIN</div><h2>A bright idea, <i>isn't it?</i></h2><p>Watch the pixels clear, type the product name, and climb the leaderboard.</p></div><div class="collection-photos"><img src="/api/showcase/3" alt="Decorative Pooky lighting"><img src="/api/showcase/4" alt="Decorative Pooky lighting"><img src="/api/showcase/5" alt="Decorative Pooky lighting"></div></section>`;
}
function lobbyMarkup(){
  const youHost=state.you===state.host;
  const full=state.players.length>=state.maxPlayers;
  const need=state.mode==='draw'?state.players.length*2:10;
  const canStart=state.players.length>=2&&state.remaining>=need&&!state.catalogueLoading;
  return `<section class="lobby"><div class="lobby-heading"><div class="eyebrow">YOUR GAME IS READY</div><h1>Bring on the <span style="color:var(--orange)">rivalry.</span></h1><p>Mode: <b>${state.mode==='sku'?'SKU Showdown':state.mode==='draw'?'Pooky Pictionary':'Pixel Panic'}</b> · Share your room code and get guessing.</p></div>
    <div class="lobby-grid"><div class="panel">
      <div class="panel-label">YOUR PRIVATE GAME CODE</div><div class="room-code">${escapeHtml(state.code)}</div>
      <div class="lobby-actions"><button class="btn btn-primary" id="copy-invite">↗ Copy invite link</button><button class="btn btn-white" id="copy-code">Copy code</button></div>
      <p class="room-note">Send the link to your colleagues. They enter a nickname and join from their own device. Everyone sees the same round and timer.</p>
      <div class="hint-card"><strong>✦ ${state.mode==='sku'?'SKU SHOWDOWN':state.mode==='draw'?'POOKY PICTIONARY':'PIXEL PANIC'}</strong><br>${state.mode==='sku'?'See the product image clearly, type its exact UK product code, and use the hints as the clock ticks down.':state.mode==='draw'?'Everybody draws twice. The artist chooses one of three secret products and has 30 seconds to draw it while everyone else guesses.':'Pictures sharpen as the 45 seconds tick down. Type the product family name to score. One-letter typos count.'}</div>
    </div><div class="panel"><div class="panel-label">PLAYERS · ${state.players.length}/${state.maxPlayers}</div><h2>In the room</h2>
      <div class="players-list">${state.players.map((p,i)=>`<div class="player-entry"><span class="avatar p${i+1}">${escapeHtml(p.name.slice(0,1).toUpperCase())}</span><div class="player-meta"><b>${escapeHtml(p.name)} ${state.you===p.id?'(you)':''}</b><span>${i===0?'Game host':'Player '+(i+1)}</span></div><span class="online ${p.online?'':'waiting'}">${p.online?'● READY':'CONNECTING'}</span></div>`).join('')}
      ${!full?`<div class="player-entry" style="border:2px dashed #ddd0c8;background:#fff"><span class="avatar" style="background:#f1ebeb;color:#b3a6a7">?</span><div class="player-meta"><b>Waiting for more players</b><span>Send the invite link...</span></div><span class="online waiting">◌ EMPTY</span></div>`:''}</div>
      ${youHost?`<button class="btn btn-dark" id="start-game" ${canStart?'':'disabled'} style="width:100%">${canStart?'Let’s play! →':state.players.length<2?'Waiting for another player...':state.catalogueLoading?'Preparing products...':'Not enough unused products'}</button>`:`<button class="btn btn-dark" disabled style="width:100%">The host will start the game...</button>`}
      <p class="statusline">${state.catalogueLoading?'⏳ Fetching Pooky product photography...':'✓ Product catalogue checked.'} ${state.photos} / ${state.catalogueCount} real product photos loaded. ${state.photos<10?'Illustrated placeholders are used where photos cannot load.':''} <br><b>${state.remaining} unseen products available for a new match.</b></p>
    </div></div>
    ${youHost?`<details class="panel upload-panel"><summary>📷 Want to use your own Pooky product photos instead?</summary><p>Select 10 or more JPG, PNG or WebP files from your computer. Use filenames like <b>Trindle.jpg</b>, <b>Freya.jpg</b> or <b>Aspen.jpg</b> — the filename becomes the product name/accepted answer. This is ideal for a game using your studio product imagery. Uploaded photos are kept temporarily on this server and disappear if it restarts.</p><input type="file" class="filefield" id="upload-files" multiple accept="image/jpeg,image/png,image/webp"/><div class="upload-progress" id="upload-progress">${state.uploads} photo${state.uploads===1?'':'s'} uploaded</div>${state.uploads>=10?`<label class="choice"><input type="checkbox" id="use-custom" ${state.useCustom?'checked':''}/> Use my uploaded images for the next game</label>`:''}</details>`:''}
      ${youHost&&state.remaining<need?'<button class="btn btn-white" id="reset-used">Reset product history (allow repeats again)</button>':''}
    </section>`;
}
const playerScoreMarkup=(p,i)=>`<div class="scorebox ${i===0?'leader':''} ${p.id===state.you?'your-score':''}" data-player-id="${escapeHtml(p.id)}"><span class="score-rank">#${i+1}</span><span class="avatar">${escapeHtml(p.name[0].toUpperCase())}</span><div class="score-content"><div class="score-name">${escapeHtml(p.name)}${p.id===state.you?' (you)':''}</div><div class="score-points">${p.score.toLocaleString('en-GB')}</div><div class="round-rank">${p.roundPlace?`${ordinal(p.roundPlace)} · +${p.roundPoints}`:'Still guessing'}</div></div></div>`;

let drawingBatch=[],drawingTimer=null,drawPaintColor='#202020',drawPaintWidth=6;
function paintLines(lines){
  const canvas=$('#draw-canvas');if(!canvas)return;
  const ctx=canvas.getContext('2d');ctx.lineCap='round';ctx.lineJoin='round';
  for(const a of lines||[]){ctx.strokeStyle=a[4];ctx.lineWidth=a[5];ctx.beginPath();ctx.moveTo(a[0]*800,a[1]*800);ctx.lineTo(a[2]*800,a[3]*800);ctx.stroke();}
}
function clearDrawing(){
  const canvas=$('#draw-canvas');if(!canvas)return;const c=canvas.getContext('2d');
  c.fillStyle='#fffdf7';c.fillRect(0,0,800,800);
}
function flushDrawing(){
  drawingTimer=null;
  if(!drawingBatch.length)return;
  const segments=drawingBatch.splice(0,40);
  api('draw',{lines:segments}).catch(()=>{});
  if(drawingBatch.length)drawingTimer=setTimeout(flushDrawing,45);
}
function initDrawingCanvas(){
  const canvas=$('#draw-canvas');if(!canvas)return;
  clearDrawing();paintLines(state.drawLines||[]);
  if(state.artistId!==state.you||state.phase!=='playing')return;
  let last=null;
  const point=event=>{const b=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(event.clientX-b.left)/b.width)),Math.max(0,Math.min(1,(event.clientY-b.top)/b.height))];};
  canvas.onpointerdown=event=>{if(event.button!==0&&event.pointerType==='mouse')return;last=point(event);canvas.setPointerCapture(event.pointerId);event.preventDefault();};
  canvas.onpointermove=event=>{
    if(!last)return;
    const next=point(event),line=[last[0],last[1],next[0],next[1],drawPaintColor,drawPaintWidth];last=next;
    paintLines([line]);drawingBatch.push(line);
    if(!drawingTimer)drawingTimer=setTimeout(flushDrawing,65);
  };
  canvas.onpointerup=canvas.onpointercancel=()=>{last=null;if(drawingTimer){clearTimeout(drawingTimer);flushDrawing();}};
  document.querySelectorAll('.draw-swatch').forEach(el=>el.onclick=()=>{drawPaintColor=el.dataset.color;document.querySelectorAll('.draw-swatch').forEach(n=>n.classList.toggle('selected',n===el));});
  const thickness=$('#draw-width');if(thickness)thickness.oninput=()=>{drawPaintWidth=Number(thickness.value)||6;};
  const clear=$('#draw-clear');if(clear)clear.onclick=()=>safe(async()=>{await api('draw',{clear:true});clearDrawing();});
}
function drawingMarkup(){
  const selecting=state.phase==='choosing',revealed=state.phase==='reveal',isArtist=state.you===state.artistId;
  const ordered=[...state.players].sort((a,b)=>b.score-a.score||b.wins-a.wins);
  const choices=isArtist?(state.choices||[]).map((item,i)=>`<button class="draw-choice" data-choice="${i}"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.family)}"><b>${escapeHtml(item.family)}</b></button>`).join(''):'';
  const workspace=selecting?`<div class="draw-choose"><h3>${isArtist?'Choose a lamp to draw':'Picking a product...'}</h3><p>${isArtist?'Only you can see the three options. Choose one, then start sketching!':escapeHtml(state.artistName||'The artist')+' is choosing from three mystery products.'}</p><div class="draw-choices">${choices}</div></div>`
    :`<div class="draw-board"><canvas id="draw-canvas" width="800" height="800" aria-label="Live Pooky drawing canvas"></canvas>
      ${revealed&&state.image?`<div class="draw-final-image"><img src="${escapeHtml(state.image)}" alt="The revealed Pooky lamp"/><div class="image-answer-bubble"><span>It's…</span><strong>${escapeHtml(state.answerFamily||'')}</strong></div></div>`:''}</div>`;
  const tools=isArtist&&!selecting&&!revealed?`<div class="draw-tools"><strong>Your drawing: ${escapeHtml(state.artistPrompt||'a mystery lamp')}</strong><div class="draw-colours">${['#202020','#db5d42','#187fa3','#478b55','#ecb52d','#a65aab'].map(c=>`<button class="draw-swatch ${c==='#202020'?'selected':''}" data-color="${c}" style="background:${c}" aria-label="Pen colour ${c}"></button>`).join('')}</div><label>Pen <input type="range" id="draw-width" min="2" max="24" value="6"></label><button id="draw-clear" class="btn btn-white">Clear canvas</button></div>`:'';
  const guessForm=!selecting&&!revealed&&!isArtist?`<form class="guess-form" id="guess-form"><input id="guess-input" class="field guess-field" placeholder="Type the product family name…" maxlength="90" autocomplete="off" required><button class="btn btn-primary" type="submit">Submit guess ↗</button></form>`:'';
  const reveal=revealed?`<div class="compact-round-summary"><strong>${escapeHtml(state.answerFamily||'')}</strong><p>${(state.placements||[]).map(p=>ordinal(p.place)+' '+escapeHtml(p.name)+' · +'+p.points).join(' / ')||'No correct guesses this round'}</p></div>`:'';
  return `<section class="game drawing-game"><div class="game-heading"><div><div class="round-kicker">POOKY PICTIONARY · ${escapeHtml(state.artistName||'')}</div><h2 class="game-title">Drawing ${state.round} / ${state.total}</h2></div><span class="draw-turn-label">${isArtist?'✎ YOUR TURN TO DRAW':'✎ GUESS THE LAMP'}</span></div>
    <div class="game-workspace"><div class="stage"><div class="image-stage drawing-stage">${workspace}</div><div class="aside">
      <div class="timer-card"><div class="timer-head"><span>${selecting?'CHOOSING A PRODUCT':revealed?'ROUND COMPLETE':'DRAWING TIME'}</span><span>${selecting?'15':'30'} SECONDS</span></div><div class="timer-num" id="timer-num">30<span>SEC</span></div><div class="progress-rail"><div class="progress-fill" id="timer-fill"></div></div></div>
      <div class="guess-card"><h3>${isArtist?'Make it recognisable!':'Can you name it?'}</h3><p>${isArtist?'Draw the lamp and help your colleagues score points. Every correct guess earns you an artist bonus.':'Watch the drawing appear live. You get points for guessing the family name correctly.'}</p>${guessForm}${tools}${reveal}</div>
    </div></div>
    <aside class="leaderboard-panel"><h3 class="leaderboard-heading">THE LEADERBOARD ✺</h3><p class="leaderboard-caption">LIVE RANKINGS</p><div class="scoreboard">${ordered.map((p,i)=>playerScoreMarkup(p,i)).join('')}</div></aside></div></section>`;
}

function gameMarkup(){
  const isReveal=state.phase==='reveal',place=state.placements||[];
  const answer=isReveal?`<div class="round-result compact-round-summary"><strong>Round finished!</strong><p>${place.length?place.map(p=>`${ordinal(p.place)}: ${escapeHtml(p.name)} (+${p.points})`).join(' · '):'No correct guesses this round.'}</p>${state.productUrl?`<a href="${escapeHtml(state.productUrl)}" target="_blank" rel="noopener noreferrer">View product on Pooky ↗</a>`:''}</div>`:'';

  return `<section class="game"><div class="game-heading"><div><div class="round-kicker">THE POOKY PRODUCT CHALLENGE</div><h2 class="game-title">Round <span style="color:var(--orange)">${state.round}</span> <span style="color:#bcaeab">/ ${state.total}</span></h2></div><div class="round-bars">${Array.from({length:state.total},(_,i)=>`<span class="${i<state.round-1?'passed':i===state.round-1?'active':''}"></span>`).join('')}</div></div>
  <div class="game-workspace"><div class="stage"><div class="image-stage" id="image-stage"><canvas id="pixel-canvas" class="pixel-canvas" width="800" height="800" aria-label="Product image gradually revealed"></canvas><div class="stage-top"><span class="stage-tag ${isReveal?'revealed':'orange'}">${isReveal?'✓ REVEALED':'✺ NAME THAT LIGHT'}</span><span class="stage-tag">${state.round} / 10</span></div><div class="stage-corner">${state.source==='photo'?'POOKY PRODUCT PHOTOGRAPH':'ILLUSTRATED DEMO IMAGE'}</div>${isReveal?`<div class="image-answer-bubble" role="status" aria-live="polite"><span>It’s…</span><strong>${escapeHtml(state.answerFamily || (state.answer || '').split(' ')[0])}</strong></div>`:''}<div id="loading-photo" class="stage-spinner">Loading image...</div></div>
  <div class="aside"><div class="timer-card"><div class="timer-head"><span>${isReveal?'ROUND COMPLETE':'TIME REMAINING'}</span><span>45 SECONDS</span></div><div class="timer-num" id="timer-num">${isReveal?'00':'45'}<span>SEC</span></div><div class="progress-rail"><div class="progress-fill" id="timer-fill"></div></div><div class="reveal-caption"><span>PICTURE REVEAL</span><span id="reveal-count">0 / 12</span></div><div class="reveal-dots" id="reveal-dots">${Array.from({length:12},()=>'<span></span>').join('')}</div></div>
  <div class="guess-card"><h3>Have a bright idea?</h3><p>Everyone gets 45 seconds to guess. Earlier correct answers earn more points!</p>
  <form class="guess-form" id="guess-form"><input id="guess-input" class="field guess-field" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Which Pooky product is it?" maxlength="90" ${isReveal?'disabled':''} required/><button class="btn btn-primary" type="submit" ${isReveal?'disabled':''}>Submit guess ↗</button></form><p class="subfoot">One letter out? We'll still count it.</p>${answer}</div></div></div>
  <aside class="leaderboard-panel" aria-label="Live leaderboard"><h3 class="leaderboard-heading">THE LEADERBOARD ✺</h3><p class="leaderboard-caption">LIVE RANKINGS · ${state.players.length} PLAYERS</p><div class="scoreboard">${[...state.players].sort((a,b)=>b.score-a.score||b.wins-a.wins).map((p,i)=>playerScoreMarkup(p,i)).join('')}</div></aside></div></section>`;
}
function endMarkup(){
  const list=[...state.players].sort((a,b)=>b.score-a.score||b.wins-a.wins);
  const winners=list.filter(p=>p.score===list[0].score);
  const tied=winners.length>1;
  const hasNext=state.remaining>=state.total;
  const youHost=state.you===state.host;
  return `<section class="end"><div class="eyebrow" style="justify-content:center">THE FINAL SCORE IS IN.</div><h1>Game <span style="color:var(--orange)">over!</span></h1><p>${tied?'A tie at the top!':'The game has finished. The winner is...'}</p>
    <div class="winner-hero"><small>${tied?'🏆 JOINT CHAMPIONS':'🏆 THE PIXEL PANIC CHAMPION'}</small><strong>${escapeHtml(tied?winners.map(p=>p.name).join(' & '):winners[0].name)}</strong><p style="margin-top:12px">${tied?'A seriously close game!':'A true Pooky product expert. Respect.'}</p></div>
    <div class="result-scores">${list.map((p,i)=>`<div><small>#${i+1}</small> <span style="font-weight:800;font-size:14px">${escapeHtml(p.name)}</span><b>${p.score.toLocaleString('en-GB')}</b><span style="font-size:12px;color:#93888e">${p.wins} rounds won</span></div>`).join('')}</div>
    <p class="stock-note">${state.remaining} previously unseen products left in this catalogue. Rematches never reuse a product name until you explicitly reset the history.</p>
    ${youHost?`${hasNext?'<button id="play-again" class="btn btn-primary" style="font-size:16px;padding:17px 28px">Play again with NEW products ↗</button>':'<p class="limit-note">Not enough fresh products remain for this mode. Reset history to play again.</p>'} <button id="reset-used" class="btn btn-white" style="margin-left:8px">Reset product history & allow repeats</button>`:'<p style="font-size:14px">Waiting for the host to start a rematch...</p>'}
    <div class="history"><h3>The round-by-round results</h3>${state.results.map(r=>`<div class="history-row"><span>ROUND ${r.round}</span><strong>${escapeHtml(r.answer)}</strong><span>${r.winner?'🏅 '+escapeHtml(r.winner):'No winner'}</span></div>`).join('')}</div>
    <button class="btn btn-white exit-room-button" style="margin-top:26px">${youHost?'Cancel game & return to menu':'Leave game & return to menu'}</button></section>`;
}

function render(force=false){
  const view=state?(state.phase==='lobby'?'lobby':state.phase==='finished'?'finished':'game'):'intro';
  const activityKey=state?`${state.players.map(p=>`${p.id}:${p.online}:${view==='lobby'?p.score:0}`).join('|')}:${state.uploads}:${state.photos}:${state.catalogueLoading}:${state.remaining}:${state.usedCount}`:'';
  const key=state?`${view}:${state.code}:${state.round}:${state.phase}:${state.gameId}`:view;
  if(!force&&key===lastView&&activityKey===lastActivityKey)return;
  lastView=key;lastActivityKey=activityKey;
  if(view==='intro')app.innerHTML=introMarkup();
  else if(view==='lobby')app.innerHTML=lobbyMarkup();
  else if(view==='finished')app.innerHTML=endMarkup();
  else {app.innerHTML=state.mode==='draw'?drawingMarkup():gameMarkup();if(state.mode==='draw')initDrawingCanvas();else mountImage();}
  if(state){
    const isHost=state.you===state.host;
    app.insertAdjacentHTML('afterbegin',`<nav class="session-toolbar" aria-label="Game controls"><span class="session-label">Room ${escapeHtml(state.code)}</span><button type="button" class="btn btn-white exit-room-button">${isHost?'✕ Cancel game & return to menu':'← Leave game & return to menu'}</button></nav>`);
  }
  attachEvents(view);
  if(view==='game'&&state.phase==='playing')$('#guess-input')?.focus({preventScroll:true});
  updateScores();updateClock();
}
function attachEvents(view){
  document.querySelectorAll('.exit-room-button').forEach(button=>{button.onclick=()=>safe(leaveCurrentRoom);});
  if(view==='intro'){
    $('#create-form').onsubmit=e=>{e.preventDefault();const n=$('#nickname').value.trim(),mode=document.querySelector('input[name="mode"]:checked')?.value||'pixel';safe(async()=>setRoom(await api('create',{name:n,mode,seen:storedUsed()})));};
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
    document.querySelectorAll('.draw-choice').forEach(el=>el.onclick=()=>safe(async()=>{await api('select-product',{choice:Number(el.dataset.choice)});}));
    const form=$('#guess-form');if(form)form.onsubmit=e=>{e.preventDefault();const input=$('#guess-input');const guess=input.value.trim();if(!guess)return;const button=$('button',form);button.disabled=true;safe(async()=>{try{const result=await api('guess',{guess});if(result.alreadyCorrect)toast('You already got this product!');}finally{if(state?.phase==='playing'){input.value='';updateScores();if(!button.disabled){input.focus({preventScroll:true});}}}});};
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
  const duration=state.roundSeconds||45;
  const elapsed=playing?duration-remains:duration;
  const revealed=playing?Math.min(12,Math.floor((elapsed+.0001)/(duration/12))):12;
  const timer=$('#timer-num');if(timer)timer.innerHTML=`${pad(Math.ceil(remains))}<span>SEC</span>`;
  const fill=$('#timer-fill');if(fill)fill.style.width=(remains/(state.roundSeconds||45)*100)+'%';
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