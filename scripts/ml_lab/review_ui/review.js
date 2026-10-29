'use strict';
const $ = id => document.getElementById(id);
let packet, index = 0, dirty = false, busy = false;
function message(text, error=false) { $('message').textContent=text; $('message').className=error?'error':''; }
function render() {
  const item=packet.items[index];
  $('progress').textContent=`已保存 ${packet.reviewed} / ${packet.total} 段`;
  $('position').textContent=`第 ${index+1} / ${packet.total} 段`;
  $('clip-title').textContent=`${item.instrument} · ${item.grade} 级`;
  $('video').src=`/media/${encodeURIComponent(item.sample_id)}`;
  $('video-error').textContent='';
  $('alias').value=item.reviewer_alias || $('alias').value;
  document.querySelectorAll('[name=verdict]').forEach(el=>el.checked=el.value===item.verdict);
  $('notes').value=item.notes;
  $('saved-at').textContent=item.reviewed_at?`上次保存：${new Date(item.reviewed_at).toLocaleString()}`:'尚未保存复核结论';
  $('previous').disabled=index===0; $('next').disabled=index===packet.total-1;
  dirty=false;
}
function move(target) {
  if (!packet || busy || target<0 || target>=packet.total) return;
  if (dirty && !confirm('当前输入尚未保存。要离开这段视频吗？')) return;
  index=target; render(); message('');
}
async function load() {
  try {
    const response=await fetch('/api/packet');
    if (!response.ok) throw new Error('无法载入复核记录。请检查连接后重新载入。');
    packet=await response.json(); render(); message('');
  } catch(error) { message(error.message,true); }
}
$('review-form').addEventListener('input',()=>dirty=true);
$('previous').onclick=()=>move(index-1);
$('next').onclick=()=>move(index+1);
$('pending').onclick=()=>{
  if (!packet) return;
  for (let offset=1;offset<=packet.total;offset++) {
    const candidate=(index+offset)%packet.total;
    if (!packet.items[candidate].verdict) { move(candidate); return; }
  }
  message('本包所有片段均已保存复核结论。');
};
$('reload').onclick=()=>{if(!busy && (!dirty || confirm('放弃尚未保存的输入，重新载入记录吗？'))) load();};
$('review-form').onsubmit=async event=>{
  event.preventDefault(); if (!packet || busy) return;
  const verdict=document.querySelector('[name=verdict]:checked')?.value;
  if (!verdict || (verdict!=='PASS' && !$('notes').value.trim())) { message('请选择复核结论；需核对或无法评审时，请写明原因。',true); return; }
  busy=true;
  const payload={sample_id:packet.items[index].sample_id,revision:packet.revision,verdict,reviewer_alias:$('alias').value.trim(),notes:$('notes').value};
  const controls=[...$('review-form').elements];
  controls.forEach(el=>el.disabled=true); message('正在保存…');
  try {
    const response=await fetch('/api/labels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const result=await response.json();
    if (!response.ok) throw new Error(result.error || '保存失败，请保留当前输入并重试。');
    packet=result; dirty=false;
    const next=packet.items.findIndex((item,i)=>i>index && !item.verdict);
    if (next>=0) index=next;
    else { const remaining=packet.items.findIndex(item=>!item.verdict); if(remaining>=0) index=remaining; }
    render(); message(packet.reviewed===packet.total?'全部片段已保存。可以导出记录。':'已保存，可以继续复核。');
  } catch(error) { message(error.message,true); }
  finally { busy=false; controls.forEach(el=>el.disabled=false); }
};
$('video').addEventListener('error',()=>{ $('video-error').textContent='视频暂时无法播放。请检查连接；不要据此直接判断视频质量。'; });
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
load();
