// Apply before styles load to avoid a bright flash.
(()=>{let choice;try{choice=localStorage.getItem('pinwell-theme')}catch{}document.documentElement.dataset.theme=choice==='dark'||choice==='light'?choice:'dark';})();
