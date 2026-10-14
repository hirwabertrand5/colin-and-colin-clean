import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
const MONGO_URI = process.env.MONGO_URI as string;
async function main(){
  await mongoose.connect(MONGO_URI);
  const User = mongoose.model('User', new mongoose.Schema({}, {strict:false}), 'users');
  const Case = mongoose.model('Case', new mongoose.Schema({}, {strict:false}), 'cases');
  const users = await User.find({}).lean();
  console.log('=== USERS ===');
  for(const u of users as any[]){
    console.log(JSON.stringify({name:u.name,email:u.email,role:u.role,isActive:u.isActive}));
  }
  const badielCandidates = (users as any[]).filter(u=>String(u.name||'').toLowerCase().includes('badiel')||String(u.email||'').toLowerCase().includes('badiel'));
  console.log('=== BADIEL CANDIDATES ===', JSON.stringify(badielCandidates,null,2));
  const cases = await Case.find({}).select('caseNo parties status assignedTo caseAssignments workflowProgress createdAt updatedAt').lean();
  console.log(`TOTAL CASES: ${cases.length}`);
  // For each user, compute counts like PeopleCapacity (exact match on name) vs dashboard backend (anchored regex name or email)
  const normalize = (v:any)=>String(v||'').trim();
  const normalizeKey = (v:any)=>normalize(v).toLowerCase().replace(/\s+/g,' ');
  const caseMatchesAssignee = (c:any, identity:any)=>{
    const me = normalize(identity).toLowerCase();
    if(!me) return false;
    return [c?.assignedTo, c?.caseAssignments?.initiator, c?.caseAssignments?.reviewer, c?.caseAssignments?.signerApprover].map(v=>normalize(v).toLowerCase()).some(v=>v&&v===me);
  };
  for(const u of users as any[]){
    const name = u.name; const email=u.email;
    const exactMatches = (cases as any[]).filter(c=>caseMatchesAssignee(c,name));
    const exactMatchesEmail = (cases as any[]).filter(c=>caseMatchesAssignee(c,email));
    // backend regex anchored
    const escapeRegExp=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const regexes=[name,email].filter(Boolean).map(v=>new RegExp(`^${escapeRegExp(String(v))}$`,'i'));
    const backendMatches=(cases as any[]).filter(c=>{
      const vals=[c?.assignedTo,c?.caseAssignments?.initiator,c?.caseAssignments?.reviewer,c?.caseAssignments?.signerApprover].map(v=>String(v||''));
      return regexes.some(rx=>vals.some(v=>rx.test(v)));
    });
    // status breakdown for exact-name matches
    const byStatus:any={};
    for(const c of exactMatches){ const s=String(c.status||'unknown'); byStatus[s]=(byStatus[s]||0)+1; }
    const byStatusBackend:any={};
    for(const c of backendMatches){ const s=String(c.status||'unknown'); byStatusBackend[s]=(byStatusBackend[s]||0)+1; }
    if(exactMatches.length!==backendMatches.length || String(name||'').toLowerCase().includes('badiel')){
      console.log(`\nUSER: ${name} <${email}> role=${u.role}`);
      console.log(`  exact-name matches=${exactMatches.length} breakdown=${JSON.stringify(byStatus)}`);
      console.log(`  exact-email extra=${exactMatchesEmail.length}`);
      console.log(`  backend(name|email anchored)=${backendMatches.length} breakdown=${JSON.stringify(byStatusBackend)}`);
    }
  }
  // Detail Badiel matches
  const badiel = badielCandidates[0] as any;
  if(badiel){
    console.log('\n=== BADIEL DETAIL ===');
    console.log(JSON.stringify(badiel,null,2));
    const bName = badiel.name; const bEmail=badiel.email;
    const escapeRegExp=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    for(const c of cases as any[]){
      const vals={assignedTo:c.assignedTo,initiator:c.caseAssignments?.initiator,reviewer:c.caseAssignments?.reviewer,signer:c.caseAssignments?.signerApprover};
      const exact = caseMatchesAssignee(c,bName);
      const exactE = caseMatchesAssignee(c,bEmail);
      const backendHit = [bName,bEmail].filter(Boolean).some(id=>{
        const rx=new RegExp(`^${escapeRegExp(String(id))}$`,'i');
        return Object.values(vals).some(v=>rx.test(String(v||'')));
      });
      // loose contains badiel?
      const loose = Object.values(vals).some(v=>String(v||'').toLowerCase().includes('badiel'));
      if(exact||exactE||backendHit||loose){
        console.log(JSON.stringify({caseNo:c.caseNo,status:c.status,assignedTo:c.assignedTo,assignments:c.caseAssignments,exact,exactE,backendHit,loose}));
      }
    }
    // also show all cases where any assignment field contains badiel case-insensitive substring
    console.log('\n=== ALL CASES loose badiel substring === done above');
  }
  await mongoose.disconnect();
}
main().catch(e=>{console.error(e);process.exit(1);});
