(function(){const a=document.createElement("link").relList;if(a&&a.supports&&a.supports("modulepreload"))return;for(const t of document.querySelectorAll('link[rel="modulepreload"]'))i(t);new MutationObserver(t=>{for(const r of t)if(r.type==="childList")for(const l of r.addedNodes)l.tagName==="LINK"&&l.rel==="modulepreload"&&i(l)}).observe(document,{childList:!0,subtree:!0});function s(t){const r={};return t.integrity&&(r.integrity=t.integrity),t.referrerPolicy&&(r.referrerPolicy=t.referrerPolicy),t.crossOrigin==="use-credentials"?r.credentials="include":t.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function i(t){if(t.ep)return;t.ep=!0;const r=s(t);fetch(t.href,r)}})();const p=`DEFINE TABLE material schemafull PERMISSIONS FULL;
DEFINE FIELD albedo ON material type array<number,3>;
DEFINE FIELD fuzz ON material TYPE number;
DEFINE FIELD emissive ON material TYPE bool;

DEFINE TABLE spheres schemafull;
DEFINE FIELD position ON spheres type array<number,3>;
DEFINE FIELD radius ON spheres TYPE number;
DEFINE FIELD material ON spheres TYPE record<material>;

DEFINE TABLE triangles schemafull;
DEFINE FIELD vertices ON triangles TYPE array<array<number,3>,3>;
DEFINE FIELD material ON triangles TYPE record<material>;
DEFINE FIELD dirs ON triangles TYPE array DEFAULT [];
DEFINE FIELD normal ON triangles TYPE array DEFAULT [];

// for some reason this doesn't work.
DEFINE EVENT set_fields ON triangles WHEN $before.vertices != $after.vertices THEN {
    let $dirs = [
        vector::subtract($after.vertices[1], $after.vertices[0]),
        vector::subtract($after.vertices[2], $after.vertices[0]),
    ];
    
    let $normal = vector::normalize(vector::cross($dirs[0],$dirs[1]));

    UPDATE triangles SET dirs=$dirs,normal=$normal WHERE id = $after.id;
};

DEFINE TABLE pixels schemafull;
DEFINE FIELD color ON pixels type array<number,3>;
DEFINE FIELD position ON pixels type array<number,2>;
DEFINE FIELD samples ON pixels type number;
DEFINE FIELD image ON pixels TYPE record<image>;

DEFINE TABLE image schemafull;
DEFINE FIELD width ON image TYPE number DEFAULT 64;
DEFINE FIELD height ON image TYPE number DEFAULT 64;

DEFINE EVENT resize ON image WHEN $before.width != $after.width OR $before.height != $after.height THEN {
    DELETE pixels WHERE image = $before.id;

    let $x_coords = array::range(0,$after.width); 
    let $y_coords = array::range(0,$after.height); 

    FOR $x IN $x_coords {
        FOR $y IN $y_coords {
            let $position = [$x,$y];
            CREATE pixels CONTENT {
                image: $after.id,
                position: $position,
                color: [255,0,0],
                x: $x,
                test: $position,
                samples: 0,
            };
        };
    };
};

DEFINE FUNCTION fn::trace($image: record<image>){
    let $aspectRatio = $image.width / $image.height;
    let $focalLength = 1.0;
    let $samples = 4;
    let $depth = 4;

    let $cameraPos = [0.0,0.0,0.5];
    let $viewportHeight = 2.0;
    let $viewportWidth = $viewportHeight * $aspectRatio;

    let $pixelDelta = vector::divide([$viewportWidth,-$viewportHeight],[$image.width,$image.height]);

    let $pixelSpaceDeltaHalf = vector::divide([$pixelDelta[0],$pixelDelta[1],0],[2.0,2.0,1.0]);

    let $viewportUpperLeft = vector::subtract(vector::subtract($cameraPos,[0,0,$focalLength]),[$viewportWidth / 2.0, -$viewportHeight / 2.0,0]);

    let $pixel0Loc = vector::add($viewportUpperLeft,$pixelSpaceDeltaHalf);

    UPDATE pixels SET color = [0,0,0];

    //let $samples = array::range(0,1);
    FOR $pix in (select * from pixels) {
        let $delta = vector::multiply($pixelDelta,$pix.position);
        let $pixelCenter = vector::add($pixel0Loc,[$delta[0],$delta[1],0.0]);

        UPDATE $pix.id SET color = [0,0,0];

        for $_ in array::range(0,$samples){
            let $jitter = vector::multiply($pixelDelta,[rand::float(-0.5,0.5),rand::float(-0.5,0.5)]);
            let $rayDir = vector::subtract(vector::add($pixelCenter,[$jitter[0],$jitter[1],0.0]),$cameraPos);
            
            UPDATE $pix.id SET color = vector::add(color,vector::multiply(fn::rayColor($cameraPos,$rayDir,$depth),[255,255,255]));
        };

    };

    UPDATE pixels SET color = vector::divide(color, [$samples,$samples,$samples]);
    RETURN null;
};

DEFINE FUNCTION fn::rayColor($origin: any, $direction: any, $depth: any){

    let $hitTestSphere = (SELECT fn::hitTestSphere(position,radius,$origin,$direction) as result, material from spheres ORDER BY result ASC)[0];
    let $hitTestTriangle = (SELECT fn::hitTestTriangle(vertices,$origin,$direction) as result, material from triangles ORDER BY result ASC)[0];

    let $hitTest = (if ($hitTestSphere.result[0] || MATH::INF) < ($hitTestTriangle.result[0] || MATH::INF) {
        $hitTestSphere
    }else {
        $hitTestTriangle
    });

    if $hitTest && $hitTest.result[0] < MATH::INF {
        let $mat = $hitTest.material;

        if $depth == 0 || $mat.emissive {
            return $mat.albedo;
        };

        let $res = $hitTest.result;
        let $normal = $res[2];
        let $hitPos = $res[1];
        let $dot2 = vector::dot($direction,$normal) * 2;
        let $reflect = vector::subtract($direction,vector::multiply($normal,[$dot2,$dot2,$dot2]));

        let $phi = rand::float() * MATH::PI * 2;
        let $thetaCos = rand::float() * 2 - 1;
        let $theta = MATH::acos($thetaCos);
        let $fuzzFac = $mat.fuzz;
        let $thetaSin = MATH::sin($theta);
        let $fuzz = [
            $thetaSin * MATH::cos($phi) * $fuzzFac,
            $thetaSin * MATH::sin($phi) * $fuzzFac,
            $thetaCos * $fuzzFac,
        ];

        let $reflected = vector::add(vector::normalize($reflect),$fuzz);

        let $newColor = fn::rayColor($hitPos,$reflected,$depth - 1);

        return vector::multiply($mat.albedo,$newColor);
    };

    let $norm = vector::normalize($direction);
    let $lerpFactor = 0.5 * ($norm[1] + 1.0);
    let $neglerpFactor = 1.0 - $lerpFactor;
    return vector::add([$neglerpFactor,$neglerpFactor,$neglerpFactor],vector::multiply([0.5,0.7,1.0],[$lerpFactor,$lerpFactor,$lerpFactor]))
};

DEFINE FUNCTION fn::hitTestTriangle($vertices: array, $origin: array, $direction: array){
    let $e1 = vector::subtract($vertices[1], $vertices[0]);
    let $e2 = vector::subtract($vertices[2], $vertices[0]);

    let $rayCrossE2 = vector::cross($direction,$e2);
    let $det = vector::dot($e1,$rayCrossE2);

    if(math::abs($det) < 0.00001){
        return [MATH::INF]
    };

    let $invDet = 1.0 / $det;
    let $s = vector::subtract($origin,$vertices[0]);
    let $u = $invDet * vector::dot($s,$rayCrossE2);

    if ($u < 0 || $u > 1){
        return [MATH::INF]
    };

    let $sCrossE1 = vector::cross($s,$e1);
    let $v = $invDet * vector::dot($direction,$sCrossE1);
    if ($v < 0 || $u + $v > 1){
        return [MATH::INF]
    };

    let $t = $invDet * vector::dot($e2,$sCrossE1);
    if ($t < 0.0001){
        return [MATH::INF]
    };

    let $hitPos = vector::add($origin,vector::multiply($direction,[$t,$t,$t]));

    let $normal = vector::normalize(vector::cross($e1,$e2));

    let $normal = (IF vector::dot($direction,$normal) > 0 {
        vector::multiply($normal,[-1,-1,-1])
    }else{
        $normal
    });
    RETURN [$t, $hitPos, $normal]
};

DEFINE FUNCTION fn::hitTestSphere($position: array,$radius: number,$origin: array, $direction: array){
    let $oc = vector::subtract($origin,$position);
    let $a = vector::dot($direction, $direction);
    let $b = vector::dot($oc,$direction);
    let $c = vector::dot($oc,$oc) - ($radius * $radius);
    let $discr = ($b*$b) - ($a*$c);

    IF $discr < 0 {
        RETURN [MATH::INF];
    };

    let $sqrtd = math::sqrt($discr);
    let $t = (-$b - $sqrtd) / $a;
    if ($t <= 0.0001){
        let $t = (-$b + $sqrtd) / $a;

        if ($t <= 0.0001){
            return [MATH::INF];
        };

        let $hitPos = vector::add($origin,vector::multiply($direction,[$t,$t,$t]));
        let $normal = vector::divide(vector::subtract($hitPos,$position),[$radius,$radius,$radius]);
        let $normal = (IF vector::dot($direction,$normal) > 0 {
            vector::multiply($normal,[-1,-1,-1])
        }else{
            $normal
        });

        RETURN [$t, $hitPos, $normal]
    };

    let $hitPos = vector::add($origin,vector::multiply($direction,[$t,$t,$t]));
    let $normal = vector::divide(vector::subtract($hitPos,$position),[$radius,$radius,$radius]);
    let $normal = (IF vector::dot($direction,$normal) > 0 {
        vector::multiply($normal,[-1,-1,-1])
    }else{
        $normal
    });

    RETURN [$t, $hitPos, $normal]
};
`,u=`# Blender 4.1.1
# www.blender.org
o Icon_00000113316389820613155240000001228407474500178859_
v 0.837311 0.050000 -0.288936
v 0.189045 0.050000 -0.288856
v 0.189045 0.050000 -0.544715
v 0.559568 0.050000 -0.340147
v 0.513225 0.050000 -0.161074
v 0.791070 0.050000 -0.314530
v 0.744730 0.050000 -0.647098
v 0.744730 0.050000 -0.595708
v 0.837311 0.050000 -0.442431
v 0.235385 0.050000 -0.672713
v 0.281626 0.050000 -0.340048
v 0.652050 0.050000 -0.340048
v 0.189045 0.050000 -0.595907
v 0.189045 0.050000 -0.698266
v 0.929991 0.050000 -0.237665
v 0.096464 0.050000 -0.749382
v 0.929991 0.050000 -0.749382
v 0.142804 0.050000 -0.723786
v 0.142804 0.050000 -0.263360
v 0.513228 0.050000 -0.058693
v 0.837311 0.050000 -0.391239
v 0.513227 0.050000 -0.109885
v 0.513228 0.050000 -0.314551
v 0.235385 0.050000 -0.468027
v 0.235385 0.050000 -0.314499
v 0.791070 0.050000 -0.365743
v 0.281727 0.050000 -0.647075
v 0.513234 0.050000 -0.774974
v 0.513228 0.050000 -0.723886
v 0.374306 0.050000 -0.647098
v 0.837311 0.050000 -0.698290
v 0.466887 0.050000 -0.647098
v 0.513228 0.050000 -0.672694
v 0.791070 0.050000 -0.519218
v 0.791070 0.050000 -0.672651
v 0.513222 0.050000 -0.826166
v 0.235385 0.050000 -0.621492
v 0.744618 0.050000 -0.340065
v 0.513122 0.050000 -0.212172
v 0.281626 0.050000 -0.391438
v 0.513128 0.050000 -0.263261
v 0.513252 0.050000 -0.877348
v 0.513228 0.050000 -0.007501
v 0.096464 0.050000 -0.237764
v 0.513228 0.050000 -0.979645
v 0.513228 0.050000 -0.928453
v 0.883552 0.050000 -0.263360
v 0.883651 0.050000 -0.723786
s 0
f 16 46 45
f 46 17 45
f 16 18 46
f 48 17 46
f 36 31 42
f 42 10 36
f 14 10 42
f 44 18 16
f 48 15 17
f 29 7 28
f 27 29 28
f 27 30 29
f 8 7 29
f 44 19 18
f 47 15 48
f 35 31 36
f 13 10 14
f 35 9 31
f 32 34 33
f 13 37 10
f 27 21 30
f 9 34 32
f 12 37 13
f 26 21 27
f 34 9 35
f 2 24 3
f 24 4 3
f 12 38 37
f 23 4 24
f 11 41 40
f 2 25 24
f 6 21 26
f 39 41 11
f 41 38 12
f 6 1 21
f 41 39 38
f 22 25 2
f 44 20 19
f 20 15 47
f 43 20 44
f 20 43 15
f 22 5 25
f 5 1 6
f 5 22 1
`,d=[64,64],m=document.getElementById("display");m.width=d[0];m.height=d[0];const f=m.getContext("2d");f.scale(4,4);async function E(n){return await new Promise((a,s)=>{const i=new WebSocket(n,"json");i.onerror=s;let t=new Map,r=[],l=0;i.sendCmd=function(o,...e){const $=++l;return i.send(JSON.stringify({id:$,method:o,params:e})),new Promise((c,v)=>{t.set($,{resolve:c,reject:v})})},i.onLiveQuery=function(o,e){const $={id:o,cb:e};return r.push($),()=>{r=r.filter(c=>{})}},i.onmessage=o=>{let e=JSON.parse(o.data);if(e.id){const $=t.get(e.id);if(!t.delete(e.id))return;e.error?$.reject(e.error):$.resolve(e.result)}else r.forEach($=>{$.id===e.result.id&&$.cb(e.result)})},i.onopen=()=>{a(i)}})}function h(n,a,s){const i=f.createImageData(1,1);i.data[0]=s[0],i.data[1]=s[1],i.data[2]=s[2],i.data[3]=255,f.putImageData(i,n,a)}async function g(n,a,s){let i=n.match(/[^\r\n]+/g);const t=[];for(const o of i){const e=o.split(" ");e[0]=="v"&&t.push([parseFloat(e[1]),parseFloat(e[3]),parseFloat(e[2])])}let r=[0,0,0];for(const o of t)for(let e=0;e<3;e++)r[e]+=o[e];r[0]/=t.length,r[1]/=t.length,r[2]/=t.length;for(const o of t)for(let e=0;e<3;e++)o[e]-=r[e],o[e]*=s[e],o[e]+=a[e];i=n.match(/[^\r\n]+/g);const l=[];for(const o of i){const e=o.split(" ");e[0]=="f"&&l.push([t[parseInt(e[1])-1],t[parseInt(e[2])-1],t[parseInt(e[3])-1]])}return l}async function F(n,a,s,i,t){const r=await g(s,i,t);for(const l of r)await n.sendCmd("create","triangles",{vertices:l,material:a})}async function T(){console.log("Starting");const n=await E("ws://127.0.0.1:8000/rpc");console.log("Connected"),await n.sendCmd("signin",{user:"root",pass:"root"}),console.log("Logged in"),await n.sendCmd("use","t","t"),await n.sendCmd("query","remove db t"),await n.sendCmd("query","remove ns t"),await n.sendCmd("use","t","t");let a=await n.sendCmd("live","pixels");n.onLiveQuery(a,e=>{const[$,c]=e.result.position;h($,c,e.result.color)});try{await n.sendCmd("query",p)}catch(e){console.log(e.message)}const s=await n.sendCmd("create","image",{width:d[0],height:d[1]});let i=[188,0,221];for(let e=0;e<3;e++)i[e]/=255,i[e]*2;const t=await n.sendCmd("create","material",{albedo:[1,0,0],fuzz:0,emissive:!1}),r=await n.sendCmd("create","material",{albedo:[.8,1,.8],fuzz:0,emissive:!1}),l=await n.sendCmd("create","material",{albedo:i,fuzz:0,emissive:!0});await n.sendCmd("create","spheres",{radius:.5,position:[-1,0,-1],material:t.id}),await n.sendCmd("create","spheres",{radius:10,position:[6,0,-11],material:r.id}),await n.sendCmd("create","spheres",{radius:.5,position:[-1,1.3,-1],material:r.id}),await F(n,l.id,u,[0,0,-.8],[1,1,1]),console.log("tracing");const o=await n.sendCmd("query","fn::trace($image)",{image:s.id});o.forEach(e=>{e.status==="ERR"&&console.error(e.result)}),console.log("Tracing took",o[0].time),console.log("done")}T().catch(console.error);
