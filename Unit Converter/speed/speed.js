let  from=document.getElementById('from');
console.log(from.value);
let to=document.getElementById('to');
console.log(to.value);
let input=document.getElementById('input');
let answer=document.getElementById('answer');
let referce=document.getElementById('btn2');


function speedcovert(){
    // answer.style.display='block';
    if(from.value=='kph' && to.value=='kph'){
       return answer.innerHTML=1*input.value+' K/h';
    }else if(from.value=='kph' && to.value=='kms'){
        return answer.innerHTML=0.00027*input.value+' Km/s';
    }else if(from.value=='kph' && to.value=='mh'){
        return answer.innerHTML=1000*input.value+' M/hr';
    }else if(from.value=='kph' && to.value=='ms'){
        return answer.innerHTML=0.2777*input.value+' M/s';
    }else if(from.value=='kph' && to.value=='cm'){
        return answer.innerHTML=1666.666*input.value+' cm/min';
    }else if(from.value=='kph' && to.value=='cs'){
        return answer.innerHTML=27.77*input.value+' cm/s';
    }
}

function refercepage(){
    window.location.reload();
}