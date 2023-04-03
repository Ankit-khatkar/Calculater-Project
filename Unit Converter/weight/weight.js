// By fromVal variabel we gets the value of unit from "from" input.
let fromVal=document.getElementById('from');
// By toVal variable we gets the value of unit from "to" input.
let toVal=document.getElementById('to');
// result variable gets the text of reslut line.
let result=document.getElementById('result');
// result.style.display='hidden';

// 
let user_input=document.getElementById('input-value');
// console.log(user_input.value);
// btn variable get the handle of button contorls.
let btn=document.getElementById('btn');
// btn.onclick=convertFun();

function convertFun() {
    let fnl_from_val=fromVal.value;
    console.log(fnl_from_val);
    let fnl_to_val=toVal.value;
    console.log(fnl_to_val);
    let fnl_user_input=user_input.value;
    // result.innerText='Working';
    result.style.visibility='visible';
    if (fnl_from_val=='gram' && fnl_to_val=='gram') {
       return result.innerText= fnl_user_input*1;
    }
    else if(fnl_from_val=='gram' && fnl_to_val=='tonne'){
        return result.innerText=fnl_user_input*0.000001;
    }
    else if(fnl_from_val=='gram' && fnl_to_val=='kilogram'){
        return result.innerText=fnl_user_input*0.001;
    }
    else if(fnl_from_val=='gram' && fnl_to_val=='pound'){
        return result.innerText=fnl_user_input*0.0022046;
    }
    else if(fnl_from_val=='gram' && fnl_to_val=='quintal'){
        return result.innerText=fnl_user_input*0.00001;
    }
    else if(fnl_from_val=='tonne' && fnl_to_val=='gram'){
        return result.innerText=fnl_user_input*1000000;
    }
    else if(fnl_from_val=='tonne' && fnl_to_val=='tonne'){
        return result.innerText=fnl_user_input*1;
    }
    else if(fnl_from_val=='tonne' && fnl_to_val=='kilogram'){
        return result.innerText=fnl_user_input*1000;
    }
    else if(fnl_from_val=='tonne' && fnl_to_val=='pound'){
        return result.innerText=fnl_user_input*2204.62;
    }
    else if(fnl_from_val=='tonne' && fnl_to_val=='quintal'){
        return result.innerText=fnl_user_input*10;
    }
    else if(fnl_from_val=='kilogram' && fnl_to_val=='gram'){
        return result.innerText=fnl_user_input*1000;
    }
    else if(fnl_from_val=='kilogram' && fnl_to_val=='tonne'){
        return result.innerText=fnl_user_input*0.001;
    }
    else if(fnl_from_val=='kilogram' && fnl_to_val=='kilogram'){
        return result.innerText=fnl_user_input*1;
    }
    else if(fnl_from_val=='kilogram' && fnl_to_val=='pound'){
        return result.innerText=fnl_user_input*2.20462;
    }
    else if(fnl_from_val=='kilogram' && fnl_to_val=='quintal'){
        return result.innerText=fnl_user_input*0.01;
    }
    else if(fnl_from_val=='pound' && fnl_to_val=='gram'){
        return result.innerText=fnl_user_input*453.5923;
    }
    else if(fnl_from_val=='pound' && fnl_to_val=='tonne'){
        return result.innerText=fnl_user_input*0.0004535;
    }
    else if(fnl_from_val=='pound' && fnl_to_val=='kilogram'){
        return result.innerText=fnl_user_input*0.4535;
    }
    else if(fnl_from_val=='pound' && fnl_to_val=='pound'){
        return result.innerText=fnl_user_input*1;
    }
    else if(fnl_from_val=='pound' && fnl_to_val=='quintal'){
        return result.innerText=fnl_user_input*0.004535;
    }
    else if(fnl_from_val=='quintal' && fnl_to_val=='gram'){
        return result.innerText=fnl_to_val*100000;
    }
    else if(fnl_from_val=='quintal' && fnl_to_val=='tonne'){
        return result.innerText=fnl_user_input*0.1;
    }
    else if(fnl_from_val=='quintal' && fnl_to_val=='kilogram'){
        return result.innerText=fnl_user_input*100;
    }
    else if(fnl_from_val=='quintal' && fnl_to_val=='pound'){
        return result.innerText=fnl_user_input*220.4622;
    }
    else if (fnl_from_val=='quintal' && fnl_to_val=='quintal'){
        return result.innerText=fnl_user_input*1;
    }
}


