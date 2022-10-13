let from = document.getElementById('select1');
let to = document.getElementById('select2');
let inputvalue = document.getElementById('inputvalue');
let btn = document.getElementById('btn');
let result = document.getElementById('final');

let mytimeout=setTimeout(webalert,5000);
function webalert() {
    y=document.getElementById('warning');
    y.innerText="NOTE:- You will not able to experience realtime currency exchange in this website.";
}
let hidewarnings=setTimeout(hidewarning,10000);
function hidewarning(){
    y=document.getElementById('warning');
    y.style.display='none';
}
function myfun() {
document.getElementById('fnllabel').style.display='block';
    if (from.value == 'usd' && to.value == 'INR') {
        result.innerText = 79.8635 * (inputvalue.value);
    } else if (from.value == 'usd' && to.value == 'taka') {
        result.innerText = 94.45 * (inputvalue.value);
    } else if (from.value == 'usd' && to.value == 'ruble') {
        result.innerText = 57.275 * (inputvalue.value);
    } else if (from.value == 'usd' && to.value == 'dinar') {
        result.innerText = 0.3077 * (inputvalue.value);
    } else if (from.value == 'usd' && to.value == 'EUR') {
        result.innerText = 0.9818 * (inputvalue.value);
    } else if (from.value == 'usd' && to.value == 'JPY') {
        result.innerText = 138.643 * (inputvalue.value);
    } else if (from.value == 'usd' && to.value == 'AUD') {
        result.innerText = 1.4554 * (inputvalue.value);
    } else if (from.value == 'usd' && to.value == 'CAD') {
        result.innerText = 1.2917 * (inputvalue.value);
    } else if (from.value == 'usd' && to.value == 'pound') {
        result.innerText = 0.8362 * (inputvalue.value);
    } else if (from.value == 'INR' && to.value == 'usd') {
        result.innerText = 0.0125 * (inputvalue.value);
    } else if (from.value == 'INR' && to.value == 'INR') {
        result.innerText = 1* (inputvalue.value);
    } else if (from.value == 'INR' && to.value == 'taka') {
        result.innerText = 1.1826* (inputvalue.value);
    } else if (from.value == 'INR' && to.value == 'ruble') {
        result.innerText = 0.7171 * (inputvalue.value);
    }else if (from.value == 'INR' && to.value == 'pound') {
        result.innerText = 0.0105 * (inputvalue.value);
    }else if (from.value == 'INR' && to.value == 'dinar') {
        result.innerText = 0.0039 * (inputvalue.value);
    }else if (from.value == 'INR' && to.value == 'EUR') {
        result.innerText = 0.0123 * (inputvalue.value);
    }else if (from.value == 'INR' && to.value == 'JPY') {
        result.innerText = 1.7361 * (inputvalue.value);
    }else if (from.value == 'INR' && to.value == 'AUD') {
        result.innerText = 0.0182 * (inputvalue.value);
    }else if (from.value == 'INR' && to.value == 'CAD') {
        result.innerText = 0.0162 * (inputvalue.value);
    }else if (from.value == 'taka' && to.value == 'taka') {
        result.innerText = 1 * (inputvalue.value);
    }else if (from.value == 'taka' && to.value == 'usd') {
        result.innerText = 0.0106 * (inputvalue.value);
    }else if (from.value == 'taka' && to.value == 'INR') {
        result.innerText = 0.8456 * (inputvalue.value);
    }else if (from.value == 'taka' && to.value == 'ruble') {
        result.innerText = 0.6064 * (inputvalue.value);
    }else if (from.value == 'taka' && to.value == 'pound') {
        result.innerText = 0.0089 * (inputvalue.value);
    }else if (from.value == 'taka' && to.value == 'dinar') {
        result.innerText = 0.0033 * (inputvalue.value);
    }else if (from.value == 'taka' && to.value == 'EUR') {
        result.innerText = 0.0104 * (inputvalue.value);
    }else if (from.value == 'taka' && to.value == 'JPY') {
        result.innerText = 1.4679 * (inputvalue.value);
    }else if (from.value == 'taka' && to.value == 'AUD') {
        result.innerText = 0.0154 * (inputvalue.value);
    }else if (from.value == 'taka' && to.value == 'CAD') {
        result.innerText = 0.0137 * (inputvalue.value);
    }else if (from.value == 'ruble' && to.value == 'ruble') {
        result.innerText = 1 * (inputvalue.value);
    }else if (from.value == 'ruble' && to.value == 'JPY') {
        result.innerText = 0.9376 * (inputvalue.value);
    }else if (from.value == 'ruble' && to.value == 'INR') {
        result.innerText = 1.3945 * (inputvalue.value);
    }else if (from.value == 'ruble' && to.value == 'taka') {
        result.innerText = 1.649 * (inputvalue.value);
    }else if (from.value == 'ruble' && to.value == 'pound') {
        result.innerText = 0.0057 * (inputvalue.value);
    }else if (from.value == 'ruble' && to.value == 'dinar') {
        result.innerText = 0.0054 * (inputvalue.value);
    }else if (from.value == 'ruble' && to.value == 'EUR') {
        result.innerText = 0.017 * (inputvalue.value);
    }else if (from.value == 'ruble' && to.value == 'AUD') {
        result.innerText = 0.0254 * (inputvalue.value);
    }else if (from.value == 'ruble' && to.value == 'CAD') {
        result.innerText = 0.0226 * (inputvalue.value);
    }else if (from.value == 'pound' && to.value == 'AUD') {
        result.innerText = 0.0254 * (inputvalue.value);
    }else if (from.value == 'pound' && to.value == 'AUD') {
        result.innerText = 0.0254 * (inputvalue.value);
    }else if (from.value == 'pound' && to.value == 'pound') {
        result.innerText = 1 * (inputvalue.value);
    }else if (from.value == 'pound' && to.value == 'usd') {
        result.innerText = 1.1959 * (inputvalue.value);
    }else if (from.value == 'pound' && to.value == 'INR') {
        result.innerText = 95.509 * (inputvalue.value);
    }else if (from.value == 'pound' && to.value == 'taka') {
        result.innerText = 112.9491 * (inputvalue.value);
    }else if (from.value == 'pound' && to.value == 'ruble') {
        result.innerText = 174.7005 * (inputvalue.value);
    }else if (from.value == 'pound' && to.value == 'dinar') {
        result.innerText = 0.3679 * (inputvalue.value);
    }else if (from.value == 'pound' && to.value == 'JPY') {
        result.innerText = 165.8015 * (inputvalue.value);
    }else if (from.value == 'pound' && to.value == 'CAD') {
        result.innerText = 1.5449 * (inputvalue.value);
    }else if (from.value == 'pound' && to.value == 'EUR') {
        result.innerText = 1.1742 * (inputvalue.value);
    }else if (from.value == 'dinar' && to.value == 'AUD') {
        result.innerText = 4.7304 * (inputvalue.value);
    }else if (from.value == 'dinar' && to.value == 'dinar') {
        result.innerText = 1 * (inputvalue.value);
    }else if (from.value == 'dinar' && to.value == 'usd') {
        result.innerText = 3.2503 * (inputvalue.value);
    }else if (from.value == 'dinar' && to.value == 'INR') {
        result.innerText = 259.5912 * (inputvalue.value);
    }else if (from.value == 'dinar' && to.value == 'taka') {
        result.innerText = 306.9835 * (inputvalue.value);
    }else if (from.value == 'dinare' && to.value == 'ruble') {
        result.innerText = 186.1593 * (inputvalue.value);
    }else if (from.value == 'dinar' && to.value == 'pound') {
        result.innerText = 2.7179* (inputvalue.value);
    }else if (from.value == 'dinar' && to.value == 'EUR') {
        result.innerText = 3.1913 * (inputvalue.value);
    }else if (from.value == 'dinar' && to.value == 'JPY') {
        result.innerText = 450.6226 * (inputvalue.value);
    }else if (from.value == 'dinar' && to.value == 'CAD') {
        result.innerText = 4.1983 * (inputvalue.value);
    }else if (from.value == 'EUR' && to.value == 'AUD') {
        result.innerText = 1.4823 * (inputvalue.value);
    }else if (from.value == 'EUR' && to.value == 'EUR') {
        result.innerText = 1 * (inputvalue.value);
    }else if (from.value == 'EUR' && to.value == 'usd') {
        result.innerText = 1.0185* (inputvalue.value);
    }else if (from.value == 'EUR' && to.value == 'INR') {
        result.innerText = 81.344 * (inputvalue.value);
    }else if (from.value == 'EUR' && to.value == 'taka') {
        result.innerText = 96.1947 * (inputvalue.value);
    }else if (from.value == 'EUR' && to.value == 'ruble') {
        result.innerText = 58.9477 * (inputvalue.value);
    }else if (from.value == 'EUR' && to.value == 'dinar') {
        result.innerText = 0.3134 * (inputvalue.value);
    }else if (from.value == 'EUR' && to.value == 'pound') {
        result.innerText = 0.8517 * (inputvalue.value);
    }else if (from.value == 'EUR' && to.value == 'JPY') {
        result.innerText = 141.21 * (inputvalue.value);
    }else if (from.value == 'EUR' && to.value == 'CAD') {
        result.innerText = 1.3156 * (inputvalue.value);
    }else if (from.value == 'JPY' && to.value == 'ruble') {
        result.innerText = 1.0665 * (inputvalue.value);
    }else if (from.value == 'JPY' && to.value == 'JPY') {
        result.innerText = 1 * (inputvalue.value);
    }else if (from.value == 'JPY' && to.value == 'usd') {
        result.innerText = 0.0072 * (inputvalue.value);
    }else if (from.value == 'JPY' && to.value == 'INR') {
        result.innerText = 0.576 * (inputvalue.value);
    }else if (from.value == 'JPY' && to.value == 'taka') {
        result.innerText = 0.6812 * (inputvalue.value);
    }else if (from.value == 'JPY' && to.value == 'dinar') {
        result.innerText = 0.0022 * (inputvalue.value);
    }else if (from.value == 'JPY' && to.value == 'pound') {
        result.innerText = 0.006 * (inputvalue.value);
    }else if (from.value == 'JPY' && to.value == 'AUD') {
        result.innerText = 0.0105 * (inputvalue.value);
    }else if (from.value == 'JPY' && to.value == 'CAD') {
        result.innerText = 0.0093* (inputvalue.value);
    }else if (from.value == 'JPY' && to.value == 'EUR') {
        result.innerText = 0.7082 * (inputvalue.value);
    }else if (from.value == 'AUD' && to.value == 'AUD') {
        result.innerText = 1 * (inputvalue.value);
    }else if (from.value == 'AUD' && to.value == 'usd') {
        result.innerText = 0.6871 * (inputvalue.value);
    }else if (from.value == 'AUD' && to.value == 'INR') {
        result.innerText = 54.874 * (inputvalue.value);
    }else if (from.value == 'AUD' && to.value == 'taka') {
        result.innerText = 64.8961 * (inputvalue.value);
    }else if (from.value == 'AUD' && to.value == 'ruble') {
        result.innerText = 39.354 * (inputvalue.value);
    }else if (from.value == 'AUD' && to.value == 'dinar') {
        result.innerText = 0.2114 * (inputvalue.value);
    }else if (from.value == 'AUD' && to.value == 'pound') {
        result.innerText = 0.5746 * (inputvalue.value);
    }else if (from.value == 'AUD' && to.value == 'EUR') {
        result.innerText = 0.6747 * (inputvalue.value);
    }else if (from.value == 'AUD' && to.value == 'CAD') {
        result.innerText = 0.8877 * (inputvalue.value);
    }else if (from.value == 'AUD' && to.value == 'JPY') {
        result.innerText = 95.264 * (inputvalue.value);
    }else if (from.value == 'CAD' && to.value == 'AUD') {
        result.innerText = 1.1268 * (inputvalue.value);
    }else if (from.value == 'CAD' && to.value == 'usd') {
        result.innerText = 0.7742 * (inputvalue.value);
    }else if (from.value == 'CAD' && to.value == 'INR') {
        result.innerText = 61.8283 * (inputvalue.value);
    }else if (from.value == 'CAD' && to.value == 'taka') {
        result.innerText =73.1205 * (inputvalue.value);
    }else if (from.value == 'CAD' && to.value == 'ruble') {
        result.innerText = 44.3414 * (inputvalue.value);
    }else if (from.value == 'CAD' && to.value == 'dinar') {
        result.innerText = 0.2382 * (inputvalue.value);
    }else if (from.value == 'CAD' && to.value == 'pound') {
        result.innerText = 0.6474* (inputvalue.value);
    }else if (from.value == 'CAD' && to.value == 'EUR') {
        result.innerText = 0.7601 * (inputvalue.value);
    }else if (from.value == 'CAD' && to.value == 'JPY') {
        result.innerText = 107.34 * (inputvalue.value);
    }else if (from.value == 'CAD' && to.value == 'CAD') {
        result.innerText = 1 * (inputvalue.value);
    }else if (from.value == 'usd' && to.value == 'usd') {
        result.innerText = 1 * (inputvalue.value);
    }
}