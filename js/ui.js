import { $, $$, state } from './core.js';

function stopInterval() { clearInterval(state.interval); state.interval = null; }
function showToast(message, type = '') { const el=$('#toast'); el.textContent=message;el.classList.toggle('warning-toast',type==='warning');el.classList.remove('hidden');clearTimeout(el._timer);el._timer=setTimeout(()=>{el.classList.add('hidden');el.classList.remove('warning-toast')},type==='warning'?5200:2200); }
function hideToast() { const el=$('#toast'); clearTimeout(el._timer); el.classList.add('hidden'); el.classList.remove('warning-toast'); }
function resetFinishDialog() {
  $('#scoreInputWrap').classList.add('hidden'); $('#questionInputWrap').classList.add('hidden'); $('#correctInputWrap').classList.add('hidden'); $('#quantityChoiceWrap').classList.add('hidden');
  $('#cancelFinishBtn').classList.remove('hidden'); $('#confirmFinishBtn').classList.remove('hidden'); $('#confirmFinishBtn').textContent = '保存记录';
}
function showCompletion(title,message){ resetFinishDialog(); $('#dialogTitle').textContent=title;$('#dialogMessage').textContent=message;$('#cancelFinishBtn').classList.add('hidden');$('#confirmFinishBtn').textContent='知道了';$('#finishDialog').showModal(); }
let drawerReturnFocus = null;
function openDrawer(drawer){
  closeDrawers(false); drawerReturnFocus = document.activeElement;
  drawer.classList.add('open'); drawer.setAttribute('aria-hidden','false'); drawer.inert = false; $('#backdrop').classList.remove('hidden');
  requestAnimationFrame(() => drawer.querySelector('.close-drawer,button,input,select,textarea')?.focus());
}
function closeDrawers(restoreFocus = true){
  const hadOpenDrawer = Boolean($('.drawer.open'));
  $$('.drawer').forEach(d=>{d.classList.remove('open');d.setAttribute('aria-hidden','true');d.inert=true});$('#backdrop').classList.add('hidden');
  if (restoreFocus && hadOpenDrawer && drawerReturnFocus?.isConnected) drawerReturnFocus.focus();
  if (hadOpenDrawer) drawerReturnFocus = null;
}

export { closeDrawers, hideToast, openDrawer, resetFinishDialog, showToast, stopInterval };
