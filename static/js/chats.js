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
