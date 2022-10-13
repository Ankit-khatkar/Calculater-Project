let km = document.getElementById('km');
let m = document.getElementById('m');
let foot = document.getElementById('foot');
let mile = document.getElementById('mile');
let inch = document.getElementById('inch');
let centimeter = document.getElementById('centimeter');


function convertfun() {
    if (m.value == '' && foot.value == '' && mile.value == '' && inch.value == '' && centimeter.value == '') {
        m.value = km.value * 1000;
        foot.value = km.value * 3280.8399;
        mile.value = km.value * 0.6214;
        inch.value = km.value * 39370.07;
        centimeter.value = km.value * 100000;
    } else if (km.value == '' && foot.value == '' && mile.value == '' && inch.value == '' && centimeter.value == '') {
        km.value = m.value * 0.001;
        foot.value = m.value * 3.2808;
        mile.value = m.value * 0.0006214;
        inch.value = m.value * 39.37;
        centimeter.value = m.value * 100;
    } else if (km.value == '' && m.value == '' && mile.value == '' && inch.value == '' && centimeter.value == '') {
        km.value = foot.value * 0.000304;
        m.value = foot.value * 0.3047;
        mile.value = foot.value * 0.0001894;
        inch.value = foot.value * 11.9999;
        centimeter.value = foot.value * 30.4799;
    } else if (km.value == '' && foot.value == '' && m.value == '' && inch.value == '' && centimeter.value == '') {
        km.value = mile.value * 1.6092;
        foot.value = mile.value * 5279.75;
        m.value = mile.value * 1609.26;
        inch.value = mile.value * 63357.06;
        centimeter.value = mile.value * 160926.93;
    } else if (km.value == '' && foot.value == '' && m.value == '' && mile.value == '' && centimeter.value == '') {
        km.value = inch.value * 0.000025;
        foot.value = inch.value * 0.0833;
        m.value = inch.value * 0.0254;
        mile.value = inch.value * 0.000015;
        centimeter.value = inch.value * 2.540;
    } else if (km.value == '' && foot.value == '' && m.value == '' && mile.value == '' && inch.value == '') {
        km.value = centimeter.value * 0.00001;
        foot.value = centimeter.value * 0.032;
        m.value = centimeter.value * 0.01;
        inch.value = centimeter.value * 0.3937;
        mile.value = centimeter.value * 0.0000062;
    }


}
