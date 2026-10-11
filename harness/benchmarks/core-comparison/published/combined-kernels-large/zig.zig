const c = @cImport(@cInclude("stdio.h"));

const spectral_n = 500;

fn matrixValue(row: usize, column: usize) f64 {
    const diagonal = row + column;
    return 1.0 / @as(f64, @floatFromInt(diagonal * (diagonal + 1) / 2 + row + 1));
}

fn multiplyAv(input: *const [spectral_n]f64, output: *[spectral_n]f64) void {
    for (0..spectral_n) |row| {
        var total: f64 = 0.0;
        for (0..spectral_n) |column| total += matrixValue(row, column) * input[column];
        output[row] = total;
    }
}

fn multiplyAtv(input: *const [spectral_n]f64, output: *[spectral_n]f64) void {
    for (0..spectral_n) |row| {
        var total: f64 = 0.0;
        for (0..spectral_n) |column| total += matrixValue(column, row) * input[column];
        output[row] = total;
    }
}

fn spectralNorm() f64 {
    var u = [_]f64{1.0} ** spectral_n;
    var v = [_]f64{0.0} ** spectral_n;
    var temporary = [_]f64{0.0} ** spectral_n;
    for (0..60) |_| {
        multiplyAv(&u, &temporary); multiplyAtv(&temporary, &v);
        multiplyAv(&v, &temporary); multiplyAtv(&temporary, &u);
    }
    var numerator: f64 = 0.0;
    var denominator: f64 = 0.0;
    for (0..spectral_n) |index| {
        numerator += u[index] * v[index]; denominator += v[index] * v[index];
    }
    return @sqrt(numerator / denominator);
}

fn fannkuch() f64 {
    const n: usize = 9;
    var permutation = [_]i32{0} ** 12;
    var working = [_]i32{0} ** 12;
    var rotations = [_]i32{0} ** 12;
    for (0..n) |index| permutation[index] = @intCast(index);
    var r = n;
    var permutation_index: i32 = 0;
    var checksum: i32 = 0;
    var maximum_flips: i32 = 0;
    while (true) {
        while (r > 1) { rotations[r - 1] = @intCast(r); r -= 1; }
        @memcpy(working[0..n], permutation[0..n]);
        var flips: i32 = 0;
        while (working[0] != 0) {
            var left: usize = 0; var right: usize = @intCast(working[0]);
            while (left < right) {
                const temporary = working[left]; working[left] = working[right]; working[right] = temporary;
                left += 1; right -= 1;
            }
            flips += 1;
        }
        maximum_flips = @max(maximum_flips, flips);
        checksum += if ((permutation_index & 1) == 0) flips else -flips;
        while (true) {
            if (r == n) return @floatFromInt(checksum * 100 + maximum_flips);
            const first = permutation[0];
            for (0..r) |index| permutation[index] = permutation[index + 1];
            permutation[r] = first; rotations[r] -= 1;
            if (rotations[r] > 0) break;
            r += 1;
        }
        permutation_index += 1;
    }
}

fn nBody() f64 {
    const solar=39.478417604357434; const days=365.24;
    var x=[5]f64{0,4.841431442464721,8.34336671824458,12.894369562139131,15.379697114850917};
    var y=[5]f64{0,-1.1603200440274284,4.124798564124305,-15.111151401698631,-25.919314609987964};
    var z=[5]f64{0,-0.10362204447112311,-0.4035234171143214,-0.22330757889265573,0.17925877295037118};
    var vx=[5]f64{0,0.001660076642744037*days,-0.002767425107268624*days,0.002964601375647616*days,0.0026806777249038932*days};
    var vy=[5]f64{0,0.007699011184197404*days,0.004998528012349172*days,0.0023784717395948095*days,0.001628241700382423*days};
    var vz=[5]f64{0,-0.0000690460016972063*days,0.000023041729757376393*days,-0.000029658956854023756*days,-0.00009515922545197159*days};
    const mass=[5]f64{solar,0.0009547919384243266*solar,0.0002858859806661308*solar,0.00004366244043351563*solar,0.000051513890204661146*solar};
    var px:f64=0;var py:f64=0;var pz:f64=0; for(0..5)|i|{px+=vx[i]*mass[i];py+=vy[i]*mass[i];pz+=vz[i]*mass[i];}
    vx[0]=-px/solar;vy[0]=-py/solar;vz[0]=-pz/solar;
    for(0..200000)|_|{for(0..5)|i|{for(i+1..5)|j|{const dx=x[i]-x[j];const dy=y[i]-y[j];const dz=z[i]-z[j];const squared=dx*dx+dy*dy+dz*dz;const magnitude=0.01/(squared*@sqrt(squared));vx[i]-=dx*mass[j]*magnitude;vy[i]-=dy*mass[j]*magnitude;vz[i]-=dz*mass[j]*magnitude;vx[j]+=dx*mass[i]*magnitude;vy[j]+=dy*mass[i]*magnitude;vz[j]+=dz*mass[i]*magnitude;}}for(0..5)|i|{x[i]+=0.01*vx[i];y[i]+=0.01*vy[i];z[i]+=0.01*vz[i];}}
    var kinetic:f64=0;for(0..5)|i|{kinetic+=0.5*mass[i]*(vx[i]*vx[i]+vy[i]*vy[i]+vz[i]*vz[i]);}
    return kinetic;
}

export fn vkf_benchmark() callconv(.c) f64 {
    return fannkuch() + fannkuch() + spectralNorm() + nBody();
}

pub fn main() void { _ = c.printf("%.17g\n", vkf_benchmark()); }
