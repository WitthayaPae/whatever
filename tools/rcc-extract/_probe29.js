const {RccArchive}=require('./rcc.js'); const idb=require('./_itemdb_probe.js');
const a=new RccArchive(process.argv[2]);
for (const n of ['item.isf','item1.isf']) {
  let raw; try { raw=a.read(n);} catch(e){ continue; }
  const r=idb.parse(raw);
  for (const it of r.items) { const b=it.basic||it; const id=b.nativeId; const m=id&0xffff, s=id>>>16;
    if ((m===29 && s===1)||(m===150 && s===127)) console.log(n, JSON.stringify(b,null,0)); }
}
