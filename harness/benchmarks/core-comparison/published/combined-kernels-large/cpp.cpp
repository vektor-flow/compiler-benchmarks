#include <cmath>
#include <cstdio>
#include <cstring>

#ifdef _WIN32
#define BENCH_EXPORT __declspec(dllexport)
#else
#define BENCH_EXPORT __attribute__((visibility("default")))
#endif

namespace spectral_norm {

constexpr int element_count = 500;

double matrix_value(int row, int column) {
    const int diagonal = row + column;
    return 1.0 / ((diagonal * (diagonal + 1) / 2) + row + 1);
}

void multiply_av(const double input[element_count], double output[element_count]) {
    for (int row = 0; row < element_count; ++row) {
        double total = 0.0;
        for (int column = 0; column < element_count; ++column) {
            total += matrix_value(row, column) * input[column];
        }
        output[row] = total;
    }
}

void multiply_atv(const double input[element_count], double output[element_count]) {
    for (int row = 0; row < element_count; ++row) {
        double total = 0.0;
        for (int column = 0; column < element_count; ++column) {
            total += matrix_value(column, row) * input[column];
        }
        output[row] = total;
    }
}

void multiply_at_av(const double input[element_count], double output[element_count]) {
    double temporary[element_count];
    multiply_av(input, temporary);
    multiply_atv(temporary, output);
}

double run() {
    double u[element_count];
    double v[element_count];
    for (int index = 0; index < element_count; ++index) u[index] = 1.0;
    for (int iteration = 0; iteration < 60; ++iteration) {
        multiply_at_av(u, v);
        multiply_at_av(v, u);
    }
    double numerator = 0.0;
    double denominator = 0.0;
    for (int index = 0; index < element_count; ++index) {
        numerator += u[index] * v[index];
        denominator += v[index] * v[index];
    }
    return std::sqrt(numerator / denominator);
}

}  // namespace spectral_norm

namespace fannkuch {

double run() {
    constexpr int element_count = 9;
    int permutation[12];
    int working[12];
    int rotations[12] = {0};
    for (int index = 0; index < element_count; ++index) permutation[index] = index;
    int rotation_count = element_count;
    int permutation_index = 0;
    int checksum = 0;
    int maximum_flips = 0;
    for (;;) {
        while (rotation_count > 1) {
            rotations[rotation_count - 1] = rotation_count;
            --rotation_count;
        }
        std::memcpy(working, permutation, sizeof(int) * element_count);
        int flips = 0;
        while (working[0] != 0) {
            for (int left = 0, right = working[0]; left < right; ++left, --right) {
                const int temporary = working[left];
                working[left] = working[right];
                working[right] = temporary;
            }
            ++flips;
        }
        if (flips > maximum_flips) maximum_flips = flips;
        checksum += (permutation_index & 1) == 0 ? flips : -flips;
        for (;;) {
            if (rotation_count == element_count) {
                return static_cast<double>(checksum * 100 + maximum_flips);
            }
            const int first = permutation[0];
            for (int index = 0; index < rotation_count; ++index) {
                permutation[index] = permutation[index + 1];
            }
            permutation[rotation_count] = first;
            if (--rotations[rotation_count] > 0) break;
            ++rotation_count;
        }
        ++permutation_index;
    }
}

}  // namespace fannkuch

namespace n_body {

struct Body {
    double x, y, z, vx, vy, vz, mass;
};

void offset_momentum(Body bodies[5]) {
    double px = 0.0;
    double py = 0.0;
    double pz = 0.0;
    for (int index = 0; index < 5; ++index) {
        px += bodies[index].vx * bodies[index].mass;
        py += bodies[index].vy * bodies[index].mass;
        pz += bodies[index].vz * bodies[index].mass;
    }
    bodies[0].vx = -px / bodies[0].mass;
    bodies[0].vy = -py / bodies[0].mass;
    bodies[0].vz = -pz / bodies[0].mass;
}

void advance(Body bodies[5], int steps) {
    for (int step = 0; step < steps; ++step) {
        for (int left = 0; left < 5; ++left) {
            for (int right = left + 1; right < 5; ++right) {
                const double dx = bodies[left].x - bodies[right].x;
                const double dy = bodies[left].y - bodies[right].y;
                const double dz = bodies[left].z - bodies[right].z;
                const double squared = dx * dx + dy * dy + dz * dz;
                const double magnitude = 0.01 / (squared * std::sqrt(squared));
                bodies[left].vx -= dx * bodies[right].mass * magnitude;
                bodies[left].vy -= dy * bodies[right].mass * magnitude;
                bodies[left].vz -= dz * bodies[right].mass * magnitude;
                bodies[right].vx += dx * bodies[left].mass * magnitude;
                bodies[right].vy += dy * bodies[left].mass * magnitude;
                bodies[right].vz += dz * bodies[left].mass * magnitude;
            }
        }
        for (int index = 0; index < 5; ++index) {
            bodies[index].x += 0.01 * bodies[index].vx;
            bodies[index].y += 0.01 * bodies[index].vy;
            bodies[index].z += 0.01 * bodies[index].vz;
        }
    }
}

double kinetic_checksum(const Body bodies[5]) {
    double result = 0.0;
    for (int left = 0; left < 5; ++left) {
        result += 0.5 * bodies[left].mass *
            (bodies[left].vx * bodies[left].vx +
             bodies[left].vy * bodies[left].vy +
             bodies[left].vz * bodies[left].vz);
    }
    return result;
}

double run() {
    constexpr double solar = 39.478417604357434;
    constexpr double days = 365.24;
    Body bodies[5] = {
        {0, 0, 0, 0, 0, 0, solar},
        {4.841431442464721, -1.1603200440274284, -0.10362204447112311,
         0.001660076642744037 * days, 0.007699011184197404 * days,
         -0.0000690460016972063 * days, 0.0009547919384243266 * solar},
        {8.34336671824458, 4.124798564124305, -0.4035234171143214,
         -0.002767425107268624 * days, 0.004998528012349172 * days,
         0.000023041729757376393 * days, 0.0002858859806661308 * solar},
        {12.894369562139131, -15.111151401698631, -0.22330757889265573,
         0.002964601375647616 * days, 0.0023784717395948095 * days,
         -0.000029658956854023756 * days, 0.00004366244043351563 * solar},
        {15.379697114850917, -25.919314609987964, 0.17925877295037118,
         0.0026806777249038932 * days, 0.001628241700382423 * days,
         -0.00009515922545197159 * days, 0.000051513890204661146 * solar}
    };
    offset_momentum(bodies);
    advance(bodies, 200000);
    return kinetic_checksum(bodies);
}

}  // namespace n_body

BENCH_EXPORT double vkf_benchmark() {
    return fannkuch::run() + fannkuch::run() + spectral_norm::run() + n_body::run();
}

int main() {
    std::printf("%.17g\n", vkf_benchmark());
    return 0;
}
