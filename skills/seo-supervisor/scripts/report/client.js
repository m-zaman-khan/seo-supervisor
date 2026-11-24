(function(){
  var DEFAULT_TAB='__DEFAULT_TAB__';
  var d=document;d.documentElement.classList.add('js');
  var root=d.documentElement,tb=d.querySelector('.theme-btn');
  if(tb){var syncTheme=function(){var light=root.dataset.theme==='light';tb.querySelector('.tl').textContent=light?'Dark':'Light';tb.setAttribute('aria-label','Switch to '+(light?'dark':'light')+' theme');};
    tb.hidden=false;syncTheme();
    tb.addEventListener('click',function(){var light=root.dataset.theme!=='light';if(light)root.dataset.theme='light';else delete root.dataset.theme;try{localStorage.setItem('seo-report-theme',light?'light':'dark')}catch(e){}syncTheme();});}
  var tabs=[].slice.call(d.querySelectorAll('.tab')),panels=[].slice.call(d.querySelectorAll('.tp'));
  function show(name,focusTab){var ok=false;tabs.forEach(function(t){var on=t.dataset.tab===name;t.setAttribute('aria-selected',on);t.tabIndex=on?0:-1;if(on){ok=true;if(focusTab)t.focus();}});
    if(!ok)return false;panels.forEach(function(p){p.hidden=p.id!=='p-'+name;});return true;}
  tabs.forEach(function(t,i){t.addEventListener('click',function(){history.replaceState(null,'','#'+t.dataset.tab);show(t.dataset.tab);});
    t.addEventListener('keydown',function(e){var k=e.key,j=i;if(k==='ArrowRight')j=(i+1)%tabs.length;else if(k==='ArrowLeft')j=(i-1+tabs.length)%tabs.length;else if(k==='Home')j=0;else if(k==='End')j=tabs.length-1;else return;
      e.preventDefault();history.replaceState(null,'','#'+tabs[j].dataset.tab);show(tabs[j].dataset.tab,true);});});
  var list=d.getElementById('flist');
  function setOpen(f,open){f.classList.toggle('open',open);f.querySelector('.f-head').setAttribute('aria-expanded',open);
    if(list)list.classList.toggle('focus',!!list.querySelector('.f.open'));}
  [].forEach.call(d.querySelectorAll('.f-head'),function(b){b.addEventListener('click',function(){var f=b.closest('.f');setOpen(f,!f.classList.contains('open'));});});
  var state={sev:'all',status:'all',area:'all',q:''};
  function apply(){if(!list)return;var n=0,all=list.children.length;[].forEach.call(list.children,function(f){
      var ok=(state.sev==='all'||f.dataset.sev===state.sev)&&(state.status==='all'||f.dataset.status===state.status)&&(state.area==='all'||f.dataset.area===state.area)&&(!state.q||f.dataset.text.indexOf(state.q)>-1);
      f.hidden=!ok;if(ok)n++;});
    d.getElementById('showing').textContent=(n===all?all:n+' of '+all)+' findings';d.getElementById('fnone').hidden=n>0;}
  [].forEach.call(d.querySelectorAll('.segb[data-sev]'),function(b){b.addEventListener('click',function(){[].forEach.call(d.querySelectorAll('.segb[data-sev]'),function(x){x.setAttribute('aria-pressed',x===b);});state.sev=b.dataset.sev;apply();});});
  var pb=[].slice.call(d.querySelectorAll('.segb[data-pstatus]'));pb.forEach(function(b){b.addEventListener('click',function(){pb.forEach(function(x){x.setAttribute('aria-pressed',x===b);});var st=b.dataset.pstatus;[].forEach.call(d.querySelectorAll('.prow'),function(r){r.hidden=st!=='all'&&r.dataset.status!==st;});});});
  var q=d.getElementById('q');if(q)q.addEventListener('input',function(){state.q=q.value.trim().toLowerCase();apply();});
  var fs=d.getElementById('fstatus');if(fs)fs.addEventListener('change',function(){state.status=fs.value;apply();});
  var fa=d.getElementById('farea');if(fa)fa.addEventListener('change',function(){state.area=fa.value;apply();});
  var fr=d.getElementById('freset');if(fr)fr.addEventListener('click',function(){state={sev:'all',status:'all',area:'all',q:''};if(q)q.value='';if(fs)fs.value='all';if(fa)fa.value='all';
    [].forEach.call(d.querySelectorAll('.segb[data-sev]'),function(x){x.setAttribute('aria-pressed',x.dataset.sev==='all');});apply();});
  [].forEach.call(d.querySelectorAll('.area[data-sev]'),function(a){a.addEventListener('click',function(e){e.preventDefault();var b=d.querySelector('.segb[data-sev="'+a.dataset.sev+'"]');if(b)b.click();history.replaceState(null,'','#findings');show('findings');window.scrollTo(0,0);});});
  [].forEach.call(d.querySelectorAll('.area[data-area]'),function(a){a.addEventListener('click',function(e){e.preventDefault();if(fa){fa.value=a.dataset.area;state.area=a.dataset.area;apply();}
    history.replaceState(null,'','#findings');show('findings');window.scrollTo(0,0);});});
  function route(e){var h=decodeURIComponent(location.hash.slice(1));if(!h){show(DEFAULT_TAB);return;}
    if(show(h)||(h.slice(0,2)==='p-'&&show(h.slice(2))))return;var f=d.getElementById(h);if(f&&f.classList.contains('f')){show('findings');f.hidden=false;setOpen(f,true);f.scrollIntoView({block:'start'});if(e)f.querySelector('.f-head').focus({preventScroll:true});}else show(DEFAULT_TAB);}
  window.addEventListener('beforeprint',function(){[].forEach.call(d.querySelectorAll('details'),function(r){r.open=true;});});
  window.addEventListener('hashchange',route);route();
})();
