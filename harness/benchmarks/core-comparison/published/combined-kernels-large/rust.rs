const N: usize = 500;

fn matrix_value(row: usize, column: usize) -> f64 {
    let diagonal = row + column;
    1.0 / ((diagonal * (diagonal + 1) / 2 + row + 1) as f64)
}

fn multiply_av(input: &[f64; N], output: &mut [f64; N]) {
    for row in 0..N {
        let mut total = 0.0;
        for column in 0..N { total += matrix_value(row, column) * input[column]; }
        output[row] = total;
    }
}

fn multiply_atv(input: &[f64; N], output: &mut [f64; N]) {
    for row in 0..N {
        let mut total = 0.0;
        for column in 0..N { total += matrix_value(column, row) * input[column]; }
        output[row] = total;
    }
}

fn spectral_norm() -> f64 {
    let mut u = [1.0; N];
    let mut v = [0.0; N];
    let mut temporary = [0.0; N];
    for _ in 0..60 {
        multiply_av(&u, &mut temporary); multiply_atv(&temporary, &mut v);
        multiply_av(&v, &mut temporary); multiply_atv(&temporary, &mut u);
    }
    let mut numerator = 0.0;
    let mut denominator = 0.0;
    for index in 0..N {
        numerator += u[index] * v[index];
        denominator += v[index] * v[index];
    }
    (numerator / denominator).sqrt()
}

fn fannkuch() -> f64 {
    const SIZE: usize = 9;
    let mut permutation = [0_i32; 12];
    let mut working = [0_i32; 12];
    let mut rotations = [0_i32; 12];
    for index in 0..SIZE { permutation[index] = index as i32; }
    let mut r = SIZE;
    let mut permutation_index = 0_i32;
    let mut checksum = 0_i32;
    let mut maximum_flips = 0_i32;
    loop {
        while r > 1 { rotations[r - 1] = r as i32; r -= 1; }
        working[..SIZE].copy_from_slice(&permutation[..SIZE]);
        let mut flips = 0_i32;
        while working[0] != 0 {
            let mut left = 0_usize;
            let mut right = working[0] as usize;
            while left < right { working.swap(left, right); left += 1; right -= 1; }
            flips += 1;
        }
        maximum_flips = maximum_flips.max(flips);
        checksum += if permutation_index & 1 == 0 { flips } else { -flips };
        loop {
            if r == SIZE { return (checksum * 100 + maximum_flips) as f64; }
            let first = permutation[0];
            for index in 0..r { permutation[index] = permutation[index + 1]; }
            permutation[r] = first;
            rotations[r] -= 1;
            if rotations[r] > 0 { break; }
            r += 1;
        }
        permutation_index += 1;
    }
}

#[derive(Clone, Copy)]
struct Body { x:f64, y:f64, z:f64, vx:f64, vy:f64, vz:f64, mass:f64 }

fn n_body() -> f64 {
    let solar = 39.478417604357434_f64;
    let days = 365.24_f64;
    let mut bodies = [
        Body{x:0.,y:0.,z:0.,vx:0.,vy:0.,vz:0.,mass:solar},
        Body{x:4.841431442464721,y:-1.1603200440274284,z:-0.10362204447112311,vx:0.001660076642744037*days,vy:0.007699011184197404*days,vz:-0.0000690460016972063*days,mass:0.0009547919384243266*solar},
        Body{x:8.34336671824458,y:4.124798564124305,z:-0.4035234171143214,vx:-0.002767425107268624*days,vy:0.004998528012349172*days,vz:0.000023041729757376393*days,mass:0.0002858859806661308*solar},
        Body{x:12.894369562139131,y:-15.111151401698631,z:-0.22330757889265573,vx:0.002964601375647616*days,vy:0.0023784717395948095*days,vz:-0.000029658956854023756*days,mass:0.00004366244043351563*solar},
        Body{x:15.379697114850917,y:-25.919314609987964,z:0.17925877295037118,vx:0.0026806777249038932*days,vy:0.001628241700382423*days,vz:-0.00009515922545197159*days,mass:0.000051513890204661146*solar},
    ];
    let (mut px, mut py, mut pz) = (0., 0., 0.);
    for body in bodies { px += body.vx*body.mass; py += body.vy*body.mass; pz += body.vz*body.mass; }
    bodies[0].vx = -px/solar; bodies[0].vy = -py/solar; bodies[0].vz = -pz/solar;
    for _ in 0..200000 {
        for i in 0..5 { for j in i+1..5 {
            let dx=bodies[i].x-bodies[j].x; let dy=bodies[i].y-bodies[j].y; let dz=bodies[i].z-bodies[j].z;
            let squared=dx*dx+dy*dy+dz*dz; let magnitude=0.01/(squared*squared.sqrt());
            let mi=bodies[i].mass; let mj=bodies[j].mass;
            bodies[i].vx-=dx*mj*magnitude; bodies[i].vy-=dy*mj*magnitude; bodies[i].vz-=dz*mj*magnitude;
            bodies[j].vx+=dx*mi*magnitude; bodies[j].vy+=dy*mi*magnitude; bodies[j].vz+=dz*mi*magnitude;
        }}
        for body in &mut bodies { body.x+=0.01*body.vx; body.y+=0.01*body.vy; body.z+=0.01*body.vz; }
    }
    let mut kinetic=0.;
    for i in 0..5 {
        let a=bodies[i]; kinetic+=0.5*a.mass*(a.vx*a.vx+a.vy*a.vy+a.vz*a.vz);
    }
    kinetic
}

#[no_mangle]
pub extern "C" fn vkf_benchmark() -> f64 {
    fannkuch() + fannkuch() + spectral_norm() + n_body()
}

fn main() { println!("{:.17}", vkf_benchmark()); }
