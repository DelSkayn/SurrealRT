DEFINE TABLE material schemafull PERMISSIONS FULL;
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
