// Native polygonizer fixture, geometry in millimetres to match the web API.
#include "flowmodeler/core/Mesh.hpp"
#include <cmath>
#include <iomanip>
#include <iostream>
using namespace flowmodeler::core;
int main() {
    Bounds bounds; bounds.include({-5,-5,-5});bounds.include({5,5,5});
    const auto m=Mesh::makeImplicitSurface("parity",bounds,0.5,[](Vec3 p){
        const double d=std::sqrt(p.x*p.x+p.y*p.y+p.z*p.z)-3.17;
        return std::max(d,-(d+1.3));
    },128);
    std::cout<<std::setprecision(17)<<"{\"vertices\":[";
    bool first=true;for(auto v:m.vertices()){if(!first)std::cout<<',';first=false;std::cout<<'['<<v.x<<','<<v.y<<','<<v.z<<']';}
    std::cout<<"],\"triangles\":[";first=true;
    for(auto t:m.triangles()){if(!first)std::cout<<',';first=false;std::cout<<'['<<t.indices[0]<<','<<t.indices[1]<<','<<t.indices[2]<<']';}
    std::cout<<"]}\n";
}
