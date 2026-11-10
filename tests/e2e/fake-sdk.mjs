// In-memory stand-in for the Firebase web SDK, used ONLY by the browser smoke test.
// It stores data in localStorage so state survives page navigations, and applies a tiny
// emulation of the access rules (admin-only collections etc.) so the UI is checked against them.
// The REAL security rules are in /firebase and must be tested in the Firebase console (see README).
const PRELUDE = `
const KEY='__fakefb';
const load=()=>JSON.parse(localStorage.getItem(KEY)||'{"docs":{},"seq":0,"user":null,"files":{}}');
const save=(s)=>localStorage.setItem(KEY,JSON.stringify(s));
const ACCOUNTS={'admin@test.com':{uid:'adminuid',pw:'secret123'},'student@test.com':{uid:'studentuid',pw:'secret123'}};
const ts=(ms)=>({toDate:()=>new Date(ms),__ts:ms});
const revive=(v)=>Array.isArray(v)?v.map(revive):(v&&typeof v==='object')?(v.__ts!==undefined?ts(v.__ts):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,revive(x)]))):v;
const isAdmin=(s)=>!!(s.user&&s.docs['admins/'+s.user.uid]);
const denied=()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
`;
export const SOURCES = {
  'firebase-app.js': `export const initializeApp=(c)=>({config:c});`,
  'firebase-auth.js': PRELUDE + `
export const getAuth=()=>({});
export const browserSessionPersistence={};
export const setPersistence=async()=>{};
export function onAuthStateChanged(a,cb){ const u=load().user; setTimeout(()=>cb(u&&{...u}),0); return ()=>{}; }
export async function signInAnonymously(){ const s=load(); s.seq++; s.user={uid:'anon'+s.seq,isAnonymous:true,email:null}; save(s); return {user:{...s.user}}; }
export async function signInWithEmailAndPassword(a,email,pw){ const acc=ACCOUNTS[email]; if(!acc||acc.pw!==pw) throw Object.assign(new Error('bad'),{code:'auth/invalid-credential'}); const s=load(); s.user={uid:acc.uid,isAnonymous:false,email}; save(s); return {user:{...s.user}}; }
export async function signOut(){ const s=load(); s.user=null; save(s); }
`,
  'firebase-storage.js': PRELUDE + `
export const getStorage=()=>({});
export const ref=(st,path)=>({path});
export async function uploadBytes(r,file,meta){ const s=load(); if(!s.user) throw denied(); if(file.size>=3*1024*1024) throw denied(); s.files[r.path]=meta.contentType; save(s); return {}; }
export async function getDownloadURL(r){ return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='; }
`,
  'firebase-firestore.js': PRELUDE + `
export const getFirestore=()=>({});
export const serverTimestamp=()=>({__sentinel:true});
export const collection=(db,...p)=>({type:'col',path:p.join('/')});
const mk=(path)=>({type:'doc',path,id:path.split('/').pop()});
export function doc(a,...p){ if(a.type==='col'&&!p.length){ const s=load(); s.seq++; save(s); return mk(a.path+'/auto'+s.seq); } return mk((a.type==='col'?[a.path,...p]:p).join('/')); }
export const where=(f,op,v)=>({k:'where',f,op,v});
export const orderBy=(f,d='asc')=>({k:'order',f,d});
export const limit=(n)=>({k:'limit',n});
export const query=(col,...c)=>({type:'query',col,c});
const snap=(path,data)=>({id:path.split('/').pop(),exists:()=>data!==undefined,data:()=>data===undefined?undefined:revive(data),ref:{path}});
function checkRead(s,path,conds){
  const [c]=path.split('/');
  if(['contacts','claims'].includes(c)&&!isAdmin(s)) throw denied();
  if(c==='admins'&&!(s.user&&path==='admins/'+s.user.uid)) throw denied();
  if(c==='items'&&conds!==null&&!isAdmin(s)&&!conds.some(x=>x.f==='visibility'&&x.v==='visible')) throw denied();
}
export async function getDoc(r){
  const s=load(); const [c]=r.path.split('/');
  if(c==='claimStatus'){ return snap(r.path,s.docs[r.path]); }
  if(c==='items'){ const d=s.docs[r.path]; if(d&&d.visibility!=='visible'&&!isAdmin(s)) throw denied(); return snap(r.path,d); }
  checkRead(s,r.path,null); return snap(r.path,s.docs[r.path]);
}
function run(q){
  const col=q.type==='col'?q:q.col, cs=q.type==='col'?[]:q.c;
  const s=load(); const conds=cs.filter(x=>x.k==='where');
  if(col.path==='claimStatus'&&!isAdmin(s)) throw denied();
  checkRead(s,col.path+'/x',conds);
  let rows=Object.entries(s.docs).filter(([p])=>p.startsWith(col.path+'/')&&p.split('/').length===col.path.split('/').length+1);
  rows=rows.filter(([,d])=>conds.every(w=>d[w.f]===w.v));
  const ob=cs.find(x=>x.k==='order');
  if(ob){ const g=(d)=>d[ob.f]&&d[ob.f].__ts!==undefined?d[ob.f].__ts:d[ob.f]; rows.sort((a,b)=>(g(a[1])>g(b[1])?1:-1)*(ob.d==='desc'?-1:1)); }
  const lm=cs.find(x=>x.k==='limit'); if(lm) rows=rows.slice(0,lm.n);
  return rows;
}
export async function getDocs(q){ const rows=run(q); return {docs:rows.map(([p,d])=>snap(p,d)),size:rows.length}; }
export async function getCountFromServer(q){ const n=run(q).length; return {data:()=>({count:n})}; }
export function writeBatch(){
  const ops=[];
  return {
    set(r,d){ ops.push(['set',r.path,d]); }, update(r,d){ ops.push(['update',r.path,d]); },
    async commit(){
      const s=load(); const now=Date.now(); const fix=(d)=>Object.fromEntries(Object.entries(d).map(([k,v])=>[k,v&&v.__sentinel?{__ts:now}:v]));
      for(const [op,path,d] of ops){
        const [c]=path.split('/');
        if(op==='set'){
          if(!s.user) throw denied();
          if(['items','contacts','claims','claimStatus'].includes(c)){ if(s.docs[path]!==undefined) throw denied(); }
          if(c==='items'&&(d.status!=='open'||d.visibility!=='visible'||d.ownerUid!==s.user.uid)) throw denied();
          if(c==='admins') throw denied();
          s.docs[path]=fix(d);
        } else {
          if(!isAdmin(s)) throw denied();
          if(s.docs[path]===undefined) throw Object.assign(new Error('not-found'),{code:'not-found'});
          s.docs[path]={...s.docs[path],...fix(d)};
        }
      }
      save(s);
    },
  };
}
`,
};
