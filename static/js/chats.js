function toggleMenu(){

    const menu=document.getElementById("menu");

    if(menu.style.display==="block"){

        menu.style.display="none";

    }else{

        menu.style.display="block";

    }

}

document.addEventListener("click",function(e){

    const menu=document.getElementById("menu");

    const button=e.target.closest("button");

    if(!button && !menu.contains(e.target)){

        menu.style.display="none";

    }

});


let deferredPrompt;

window.addEventListener("beforeinstallprompt", (e) => {

    e.preventDefault();

    deferredPrompt = e;

    document.getElementById("installPopup").classList.add("show");

});

document.getElementById("installBtn").onclick = async () => {

    if(!deferredPrompt) return;

    deferredPrompt.prompt();

    await deferredPrompt.userChoice;

    document.getElementById("installPopup").classList.remove("show");

    deferredPrompt = null;

};
