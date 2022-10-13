function myfun() {
    document.getElementById("calculateNum").value = '';
}
let x = document.getElementById("calculateNum");

function myfun2() {
    x = document.getElementById("calculateNum");
    x.value=x.value.slice(0,-1);
}

