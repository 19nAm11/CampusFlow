// Browser regression test with mocked Supabase; never writes to the live project.
// Run: node tests/study-practice-ui.cjs (requires Playwright).
// Optional: PLAYWRIGHT_MODULE points to a bundled module; BROWSER_PATH selects a browser.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '..');
(async () => {
 const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH} : {})});
 try {
  const context = await browser.newContext({viewport:{width:1500,height:1000}});
  await context.addInitScript(() => {
   let callback;
   const user = {id:'test-user',email:'student@example.test',user_metadata:{full_name:'Alex Nguyen'}};
   const state = window.__test = {db:JSON.parse(localStorage.getItem('test-db') || '{"saved_courses":[],"saved_quizzes":[],"saved_conversations":[]}'), requests:[], failSave:false, failAI:false, delay:0, changeUser: signedIn => callback('SIGNED_IN', signedIn ? {user} : null)};
   function query(table) {
    let op='select', row, filters=[];
    const q = {
     select: () => q, eq: (k,v) => {filters.push([k,v]);return q;}, order: () => q,
     insert: v => {op='insert';row=v;return q;}, upsert: v => {op='upsert';row=v;return q;},
     delete: () => {op='delete';return q;}, update: v => {op='update';row=v;return q;},
     single: () => execute(true), then: (a,b) => execute(false).then(a,b)
    };
    async function execute(single) {
     if (table==='saved_conversations' && op==='upsert' && state.failSave) return {error:{message:'Test save failed'}};
     const matches = item => filters.every(([k,v]) => item[k]===v);
     let rows=state.db[table], data;
     if(op==='select') data=rows.filter(matches);
     else if(op==='delete') {data=rows.filter(matches); state.db[table]=rows.filter(item=>!matches(item));}
     else if(op==='update') {data=rows.filter(matches);data.forEach(item=>Object.assign(item,row));}
     else {
      let item=op==='upsert' && rows.find(item=>item.id===row.id);
      if(item) Object.assign(item,structuredClone(row));
      else {item={id:crypto.randomUUID(),created_at:new Date().toISOString(),...structuredClone(row)};rows.unshift(item);}
      data=[item];
     }
     localStorage.setItem('test-db',JSON.stringify(state.db));
     return {data:structuredClone(single?data[0]:data)};
    }
    return q;
   }
   window.supabase={createClient:()=>({from:query,auth:{getSession:async()=>({data:{session:{user}}}),onAuthStateChange:cb=>{callback=cb;}},functions:{invoke:async(name,{body})=>{
    const mode=body.get('mode');state.requests.push({mode,prompt:body.get('prompt'),history:JSON.parse(body.get('history')||'[]'),files:body.getAll('file').length});
    const fail=state.failAI; await new Promise(r=>setTimeout(r,state.delay));
    if(fail) return {error:new Error('Test AI failed')};
    if(mode==='quiz') return {data:{requestedCount:2,quiz:{title:'Photosynthesis quiz',questions:[1,2].map(i=>({id:'Q'+i,question:'Question '+i,options:['Sunlight','Wind','Sound','Gravity'],correctIndex:0,explanation:'Sunlight supplies the energy.'}))}}};
    if(mode==='study') return {data:{cards:[{title:'Notes',points:['Plants use light.']}]}};
    return {data:{reply:'Photosynthesis uses sunlight to make food.\n\nChlorophyll captures light energy.'}};
   }}})};
  });
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='campusflow.test') {
    const file=url.pathname.slice(1);
    if(!['index.html','main.css','study.css','script.js','supabase-config.js'].includes(file)) return route.fulfill({status:404,body:''});
    return route.fulfill({body:await fs.readFile(root+'/'+file),contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html'});
   }
   if(url.hostname==='unpkg.com') return route.fulfill({body:'window.lucide = {createIcons() {}};',contentType:'application/javascript'});
   return route.fulfill({body:'',contentType:'application/javascript'});
  });
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  await page.goto('https://campusflow.test/index.html');
  await page.locator('[data-page="study"]').click();

  const settled=()=>page.waitForFunction(()=>!studyIsSubmitting&&!studyConversationPending&&!studyQuizMutationPending);
  const send=async prompt=>{await page.locator('#study-request').fill(prompt);await page.locator('#study-send').click();await settled();};
  const quizToggle=()=>page.locator('#study-practice-history .study-saved-quiz-open').first();
  const explain=async index=>{await page.locator('.study-explain-button').nth(index).click();await settled();};
  await send('Teach me photosynthesis');
  const originalId=await page.evaluate(()=>studyConversationId);
  await send('Make a quiz with 2 questions');
  const quizId=await page.evaluate(()=>studyQuiz.id);
  assert.equal(await page.locator('.study-conversation-history').isVisible(),false);
  const expandedHeight=await page.locator('.study-practice-history').evaluate(el=>el.clientHeight);
  await quizToggle().click();
  assert.equal(await page.locator('.study-conversation-history').isVisible(),true);
  const heights=await page.evaluate(()=>['.study-practice-history','.study-conversation-history'].map(s=>document.querySelector(s).getBoundingClientRect().height));
  assert.ok(Math.abs(heights[0]-heights[1])<2,JSON.stringify(heights));
  assert.ok(expandedHeight>heights[0]*1.8);
  await quizToggle().click();
  for(let i=0;i<2;i++) {await page.locator('.study-question').nth(i).locator('.study-choice').nth(1).click();await settled();}
  await explain(0);
  assert.equal(await page.evaluate(()=>studyConversationId),quizId);
  assert.equal(await page.evaluate(()=>__test.db.saved_conversations.length),2);
  assert.equal(await page.evaluate(id=>__test.db.saved_conversations.find(c=>c.id===id).messages.length,originalId),4);
  await explain(1);
  assert.equal(await page.evaluate(()=>studyCards.length),2);
  assert.equal(await page.evaluate(()=>__test.db.saved_conversations.length),2);
  const calls=await page.evaluate(()=>__test.requests.length);
  await explain(0);
  assert.equal(await page.evaluate(()=>__test.requests.length),calls);
  assert.equal(await page.evaluate(()=>studyCards.length),2);
  await page.reload();
  await page.locator('[data-page="study"]').click();
  await page.locator('#study-practice-toggle').click();
  await quizToggle().click();
  await explain(1);
  assert.equal(await page.evaluate(()=>studyConversationId),quizId);
  assert.equal(await page.evaluate(()=>studyCards.length),2);
  assert.equal(await page.evaluate(()=>__test.requests.length),0);
  // A different quiz gets its own saved explanation conversation.
  await page.evaluate(()=>{
    const quiz={...structuredClone(savedQuizzes[0]),id:crypto.randomUUID(),title:'Second quiz'};
    __test.db.saved_quizzes.unshift(quiz);savedQuizzes.unshift(quiz);openSavedQuiz(quiz);
  });
  await explain(0);
  assert.equal(await page.evaluate(()=>__test.db.saved_conversations.length),3);
  assert.notEqual(await page.evaluate(()=>studyConversationId),quizId);
  // Save failure keeps the explanation available; Retry saves without another AI request.
  await page.evaluate(()=>{__test.failSave=true;});
  await explain(1);
  assert.equal(await page.locator('#study-retry-save').isVisible(),true);
  const beforeRetry=await page.evaluate(()=>__test.requests.length);
  await page.evaluate(()=>{__test.failSave=false;});
  await page.locator('#study-retry-save').click();await settled();
  assert.equal(await page.evaluate(()=>__test.requests.length),beforeRetry);
  assert.equal(await page.locator('#study-retry-save').isVisible(),false);
  // Clear leaves saved histories intact. Removing an explanation conversation allows recreation.
  await page.locator('#study-clear-cards').click();
  assert.equal(await page.evaluate(()=>__test.db.saved_conversations.length),3);
  await page.locator('#study-practice-toggle').click();
  await page.locator('.study-saved-conversation').filter({hasText:'Second quiz'}).locator('.study-saved-quiz-delete').click();await settled();
  assert.equal(await page.evaluate(()=>__test.db.saved_conversations.length),2);
  await quizToggle().click();await explain(0);
  assert.equal(await page.evaluate(()=>__test.db.saved_conversations.length),3);
  assert.equal(await page.evaluate(()=>studyCards.length),1);
  // Populate lists to prove independent scroll areas and non-shrinking cards.
  await quizToggle().click();
  await page.evaluate(()=>{
    for(let i=0;i<20;i++){
      savedQuizzes.push({...savedQuizzes[0],id:crypto.randomUUID(),title:'Extra quiz '+i});
      savedConversations.push({...savedConversations[0],id:crypto.randomUUID(),title:'Extra conversation '+i});
    }
    renderStudyQuiz();
  });
  for(const width of [1500,820,390]) {
    await page.setViewportSize({width,height:900});
    const layout=await page.evaluate(()=>{
      const a=document.getElementById('study-practice-history'),b=document.getElementById('study-conversation-list');
      a.scrollTop=80;b.scrollTop=120;
      return {heights:[a.parentElement.clientHeight,b.parentElement.clientHeight],overflow:[a.scrollHeight>a.clientHeight,b.scrollHeight>b.clientHeight],scroll:[a.scrollTop,b.scrollTop],pageOverflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.ok(Math.abs(layout.heights[0]-layout.heights[1])<2,JSON.stringify(layout));
    assert.deepEqual(layout.overflow,[true,true]);
    assert.deepEqual(layout.scroll,[80,120]);
    assert.equal(layout.pageOverflow,false);
  }
  await page.setViewportSize({width:1500,height:1000});
  await page.evaluate(()=>{document.getElementById('study-practice-history').scrollTop=0;});
  await quizToggle().click();
  assert.deepEqual(errors,[]);
  console.log('PASS: equal independently scrolling sections, quiz expansion/collapse, per-quiz explanation conversations, unrelated chat preserved, deduplication, reload, different quizzes, save failure/retry, Clear preservation, delete/recreate, responsive. No browser errors.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

