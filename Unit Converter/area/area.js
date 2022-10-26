let from=document.getElementById('select1');
let to=document.getElementById('select2');
let output=document.getElementById('output');
let result=document.getElementById('value');
let btn = document.getElementById('btn');


function convert(from,to,output,value){
    document.getElementById('output').style.display='block';
    if(from.value=='squaremeter' && to.value=='squaremeter'){
        output.innerText=`${result.value*1}`;
    }else if(from.value=='squaremeter' && to.value=='squarecentimeter'){
        output.innerText=`${result.value*10000}`;
    }else if(from.value=='squaremeter' && to.value=='squaremile'){
        output.innerText=`${result.value*3.861E-7}`;
    }else if(from.value=='squaremeter' && to.value=='hactar'){
        output.innerText=`${result.value*0.0001}`;
    }else if(from.value=='squaremeter' && to.value=='squareyard'){
        output.innerText=`${result.value*1.19599}`;
    }else if(from.value=='squaremeter' && to.value=='squarefoot'){
        output.innerText=`${result.value*10.7639104}`;
    }else if(from.value=='squaremeter' && to.value=='acre'){
        output.innerText=`${result.value*0.0002471}`;
    }else if(from.value=='squaremeter' && to.value=='squareinch'){
        output.innerText=`${result.value*1550.0031}`;
    }else if(from.value=='squarecentimeter' && to.value=='squaremeter'){
        output.innerText=`${result.value*0.0001}`;
    }else if(from.value=='squarecentimeter' && to.value=='squarecentimeter'){
        output.innerText=`${result.value*1}`;
    }else if(from.value=='squarecentimeter' && to.value=='squaremile'){
        output.innerText=`${result.value*3.861E-11}`;
    }else if(from.value=='squarecentimeter' && to.value=='hactar'){
        output.innerText=`${result.value*1E-8}`;
    }else if(from.value=='squarecentimeter' && to.value=='squareyard'){
        output.innerText=`${result.value*0.000119599}`;
    }else if(from.value=='squarecentimeter' && to.value=='squarefoot'){
        output.innerText=`${result.value*0.0010763}`;
    }else if(from.value=='squarecentimeter' && to.value=='acre'){
        output.innerText=`${result.value*2.471E-8}`;
    }else if(from.value=='squarecentimeter' && to.value=='squareinch'){
        output.innerText=`${result.value*0.15500031}`;
    }
}